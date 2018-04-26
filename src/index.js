// import styles (need to do this for webpack to handle stylesheet files)
import './styles/main.css';
import './styles/main.scss';

// axios handles requests
import axios from 'axios';

// mapping and geometry modules
import L from 'leaflet';
import leafletDraw from 'leaflet-draw';
import selectArea from 'leaflet-area-select';
import * as turf from '@turf/turf';

// our module for drawing choropleth maps
import Choropleth from './choro';

// global constants
const SELECTED_COLOR = '#444';
const NORMAL_COLOR = '#000';
const BUFFER_RADIUS = 0.5; // units = miles

// we're going to only do some things when in production modex, ex: only show 'directions' modal 
// immediately when in production mode (otherwise, it's annoying for debugging purposes to have to 
// close the window each reload)
const IS_PROD = process.env.NODE_ENV === 'production';

var delete_mode = false;

var areas = {
    'btn-sd-county': {
        files: {
            polygons: 'data/sd_cbgs_latest_attributes_normed3.geojson', 
            stations: 'data/sd-rail-stations-buffered.geojson'
        },
        center: [32.7157, -117.11],
        zoom: 12
    },
    'btn-sm-county': {
        files: {
            polygons: 'data/san-mateo-with-data_normed3.geojson',
            stations: 'data/stations-san-mateo.geojson'
        },
        center: [37.56, -122.313],
        zoom: 12
    }
};
        
// variables that will reference out leaflet layers and map object
var geojsonLayer;
var stationsLayer;

// create a leaflet map object
var map = L.map('map').setView([32.7157, -117.11], 12);

// create a mapbox basemap layer and add to map
var basemap_url = 'https://api.tiles.mapbox.com/v4/{id}/{z}/{x}/{y}.png?access_token=pk.eyJ1IjoibWFwYm94IiwiYSI6ImNpejY4NXVycTA2emYycXBndHRqcmZ3N3gifQ.rJcFIG214AriISLbB6B5aw';

L.tileLayer(basemap_url, {
    maxZoom: 18,
    attribution: '',
    id: 'mapbox.streets'
}).addTo(map);

// these variables are related to the selection of features and the aggregate scores for the
// different variables
var hits = 0;
var selections = 0;
var sums = {
    hh_type1_vmt: 0.0,
    'SumAllPed': 0.0,
    'JTW_TOTAL': 0.0,
    'JTW_WALK': 0.0,
    'hh_type1_h': 0.0,
    'D3b': 0.0,
    'D5br_cleaned': 0.0,
    'D1A': 0.0,
    'D1B': 0.0,
    'D1C': 0.0,
    TOTPOP1: 0,
    pop_ped: 0
};


$('.btn-squared').click(function () {
    $('#modal-select-city').modal('hide');

    if (IS_PROD) {
        $('#modal-directions').modal('show');
    }

    var area = areas[this.id];

    map.setView(area.center, area.zoom);

    var GEOJSON_FILES = [area.files.polygons, area.files.stations];

    // use axios to get the geojson files we need for this map 
    axios.all(GEOJSON_FILES.map(axios.get))
        .then((resp) => {
            var [resp1, resp2] = resp;

            // create a choropleth map using the CBG features
            // initially use VMT as the choropleth property
            geojsonLayer = new Choropleth(resp1.data, {
                property: 'hh_type1_vmt',
                style: (f) => {
                    return {
                        color: f.properties._selected ? SELECTED_COLOR : NORMAL_COLOR,
                        weight: f.properties._selected ? 2. : 0.0,
                        opacity: 1.0,
                        fillOpacity: 0.4
                    };
                },
                onEachFeature: (f, l) => { }
            }).addTo(map);

console.log(resp2.data);

            // add the stations layer to the map
            // set style of stations layer based on typology
            stationsLayer = L.geoJSON(resp2.data, {
                style: (f) => {
                    var style = {
                        weight: 0.0,
                        fillOpacity: .5
                    };

                    const typology = f.properties.FINAL_TYPO;
                   
                    if (typology === 'INTEGRATED' || typology > 2.0) {
                        style.fillColor = 'green';
                    } else if (typology === 'TRANSITIONING' || typology > 1.0) {
                        style.fillColor = 'yellow';
                    } else {
                        style.fillColor = 'red';
                    }

                    return style;
                },
                onEachFeature: (f, l) => {
                    // todo: move this to util file
                    function titleCase(s) {
                        return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
                    }

                    var msg = `
                        <span class='font-weight-bold'> Station: </span> ${f.properties.FULL_NAME || 'None'} <br>
                        <span class='font-weight-bold'> Typology: </span> ${titleCase(f.properties.FINAL_TYPO)}`;
                    
                    //l.bindPopup(msg);
                }
            }).addTo(map);

            // add control to map (allows users to turn off/on layers)
            L.control.layers([], {
                'Stations': stationsLayer
            }).addTo(map);
        });
});

// create an event handler for when the user clicks the drop-down menu
// to select a layer for visualization
$('.dropdown-menu a').click(function () {

    // first, set button text to selected value 
    // (this is a bit of a hack, since bootstrap doesn't really support dropdowns)
    console.log(this.text);
    $('#btn-label').text(this.text);

    // this is a mapping of the drop-down options to a variable name 
    // or function that computes the attribute value for a specific feature
    var prop = {
        vmt: 'hh_type1_vmt',
        housing: 'hh_type1_h',
        pedcol: (item) => {
            var total_collisions = item.properties['SumAllPed'];
            var walk_pct = item.properties['JTW_WALK'] / item.properties['JTW_TOTAL'];
            var population = item.properties['TOTPOP1']; 

            var ped_per_100k = 100000 * (total_collisions / population);
            var ped_per_100k_walk = ped_per_100k / walk_pct;
            var ped_per_100k_walk_daily = ped_per_100k_walk / 365.0;

            return ped_per_100k_walk_daily;
        },
        ghg: (item) => {
            return item.properties['hh_type1_vmt'] * .90;
        },
        'dwelling-density': 'D1A',
        'people-density': 'D1B',
        'jobs-density': 'D1C',
        'ped-environment': 'D3b',
        'jobs-accessibility': 'D5br_cleaned'
    }[this.id]; // using [this.id] will select the option specified by 'this.id'

    // update the choropleth layer with the new property
    geojsonLayer.setProperty(prop, true); 

});

// add layer to hold the drawn features
var drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);

// add the drawing controls
var drawControlOptions = {
    edit: {
        featureGroup: drawnItems,
        edit: false
    }, draw: {
        polygon: true,
        circle: false,
        circlemarker: false,
        rectangle: false
    }
};

var drawControl = new L.Control.Draw(drawControlOptions);
map.addControl(drawControl);

// add event handler for when a drawn feature is starting to be deleted
// note: this is just a placeholder...we need to handle 
// deletes more gracefully
map.on(L.Draw.Event.DELETED, (e) => {
    delete_mode = false;
    console.log(e);
});

map.on('draw:deletestart', (e) => {
    delete_mode = true;
    console.log(e);
});

// add event handler for when a drawn feature is deleted 
map.on(L.Draw.Event.DELETESTOP, (e) => {
    delete_mode = false;

    // when a drawn feature is deleted, we want to reset the readouts
    hits = 0;
    sums = {
        hh_type1_vmt: 0.0,
        'SumAllPed': 0.0,
        'JTW_TOTAL': 0.0,
        'JTW_WALK': 0.0,
        'hh_type1_h': 0.0,
        'D3b': 0.0,
        'D5br_cleaned': 0.0,
        'D1A': 0.0,
        'D1B': 0.0,
        'D1C': 0.0,
        TOTPOP1: 0,
        pop_ped: 0
    };

    // reset style of selected features
    geojsonLayer.setStyle((f) => {

        f.properties._selected = false; // BAD!!! SIDE EFFECT!!!

        return {
            color: NORMAL_COLOR,
            weight: 0.0
        };
    });

    // get the readout divs in order to reset
    var vmt = document.querySelector('#stat-vmt');
    var ghg = document.querySelector('#stat-ghg');
    var pedcol = document.querySelector('#stat-pedcol');
    var cbgs = document.querySelector('#stat-cbgs');
    var housing = document.querySelector('#stat-housing');
    var pedenv = document.querySelector('#stat-ped-environment');
    var jobsaccess = document.querySelector('#stat-jobs-accessibility');
    var dwellingdensity = document.querySelector('#stat-dwelling-density');
    var persondensity = document.querySelector('#stat-population-density');
    var jobsdensity = document.querySelector('#stat-jobs-density');

    // set all values to 'N/A'
    vmt.innerHTML = 'N/A';
    ghg.innerHTML = 'N/A';
    pedcol.innerHTML = 'N/A';
    cbgs.innerHTML = 'N/A';
    housing.innerHTML = 'N/A';
    pedenv.innerHTML = 'N/A';
    jobsaccess.innerHTML = 'N/A';
    dwellingdensity.innerHTML = 'N/A';
    persondensity.innerHTML = 'N/A';
    jobsdensity.innerHTML = 'N/A';
});


// add event handler for when a feature is drawn by the user
map.on(L.Draw.Event.CREATED, (e) => {

    var buffer;
    var layer = e.layer;
    var opts = { units: 'miles' };

    // this is where we take the drawn feature and draw a buffer around
    if (e.layerType === 'marker') {
        var coords = [layer._latlng.lng, layer._latlng.lat];
        buffer = turf.circle(coords, BUFFER_RADIUS, opts);
    } else if (e.layerType === 'circle') {
        var coords = [layer._latlng.lng, layer._latlng.lat];
        buffer = turf.circle(coords, BUFFER_RADIUS, opts);
    } else if (e.layerType === 'polyline') {
        var coords = layer._latlngs.map((item) => {
            return [item.lng, item.lat];
        });
        buffer = turf.buffer(turf.lineString(coords), BUFFER_RADIUS, opts);
    } else {
        var coords = layer._latlngs.map((ring) => {
            return ring.map((poly) => {
                return [poly.lng, poly.lat];
            });
        });

        // need to complete the polygon by repeating first coords
        coords[0].push(coords[0][0]);
        buffer = turf.polygon(coords);
    }

    // need to grab the CBG layer as a geojson in order to
    // iterate over features
    var cbgs = geojsonLayer.toGeoJSON();

    var bufferLayer = new L.geoJson(buffer);

    // is this legit? to delete a layer?
    bufferLayer.on('click', (e) => { 
        if (delete_mode) {
            map.removeLayer(e.layer); 
            map.fire(L.Draw.Event.DELETESTOP);
        }
    });

    //bufferLayer.bindPopup('Selected Area:');

    // add feature to drawing layer
    drawnItems.addLayer(bufferLayer);

    // go through each CBG feature and determine
    // whether intersects the drawn feature
    cbgs.features.forEach((f) => {

        // turf.insersect does not work for multipolygons...
        function intersects(a, b) {

            if (b.geometry.type === 'Polygon') {
                return turf.intersect(a, b);
            } else if (b.geometry.type === 'MultiPolygon') {
                var polys_coords = b.geometry.coordinates;

                for (var i = 0; i < polys_coords.length; i++) {
                    var polygon = {
                        geometry: {
                            type: 'Polygon',
                            coordinates: polys_coords[i]
                        }
                    };

                    if (turf.intersect(a, polygon)) {
                        return true;
                    }
                }
            }

            return false;
        }

        // if this feature intersects with the drawn feature,
        // sum up the attributes
        if (intersects(buffer, f)) {
            f.properties._selected = true;
            var keys = Object.keys(sums);

            keys.forEach((k) => {
                // only parsing int because some variables are being converted to 
                // strings when exporting to geojson... (fix this!!)
                sums[k] = (sums[k] + parseInt(f.properties[k])) || sums[k];
            });

            hits++;

            function isNumeric(n) {
                return !isNaN(parseFloat(n)) && isFinite(n);
            }

            if (isNumeric(f.properties['SumAllPed'])) {
                sums.pop_ped += f.properties.TOTPOP1;
            }
        }
    });

    // set style of selected CBGs
    geojsonLayer.setStyle((f) => {
        return {
            color: f.properties._selected ? SELECTED_COLOR : NORMAL_COLOR,
            weight: f.properties._selected ? 2. : 0.0
        };
    });

    // grab DIVs for the readouts
    var vmt = document.querySelector('#stat-vmt');
    var ghg = document.querySelector('#stat-ghg');
    var dwellingdensity = document.querySelector('#stat-dwelling-density');
    var personsdensity = document.querySelector('#stat-population-density');
    var jobsdensity = document.querySelector('#stat-jobs-density');
    var pedcol = document.querySelector('#stat-pedcol');
    var cbgs = document.querySelector('#stat-cbgs');
    var housing = document.querySelector('#stat-housing');
    var pedenv = document.querySelector('#stat-ped-environment');
    var jobsaccess = document.querySelector('#stat-jobs-accessibility');


    function withCommas(x) {
        return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    var total_collisions = sums['SumAllPed'];
    var walk_pct = sums['JTW_WALK'] / sums['JTW_TOTAL'];

    var ped_per_100k = 100000 * (total_collisions / sums.pop_ped);
    var ped_per_100k_walk = ped_per_100k / walk_pct;
    var ped_per_100k_walk_daily = ped_per_100k_walk / 365.0;

    // set values for readouts (according to formatting)
    dwellingdensity.innerHTML = (sums['D1A'] / hits).toFixed(2);
    personsdensity.innerHTML = (sums['D1B'] / hits).toFixed(2);
    jobsdensity.innerHTML = (sums['D1C'] / hits).toFixed(2);
    vmt.innerHTML = withCommas((sums['hh_type1_vmt'] / hits).toFixed(0));
    ghg.innerHTML = withCommas(((sums['hh_type1_vmt'] / hits) * .90).toFixed(0));
    housing.innerHTML = (sums['hh_type1_h'] / hits).toFixed(1);
    pedcol.innerHTML = isFinite(ped_per_100k_walk_daily) ? ped_per_100k_walk_daily.toFixed(2) : 'N/A';
    pedenv.innerHTML = (sums['D3b'] / hits).toFixed(1);
    jobsaccess.innerHTML = withCommas((sums['D5br_cleaned'] / hits).toFixed(0));
    cbgs.innerHTML = hits;

});


