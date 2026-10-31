/* New Orleans Streetcar System -- route data, stops, and helpers
   4 lines: St. Charles (green), Canal Street (red), Riverfront (burgundy), Rampart-St. Claude (teal)
   Fare: $1.25 per ride / $3 Jazzy Pass day pass / $0.40 seniors+disabled
   Source: norta.com — New Orleans Regional Transit Authority */

(function(){
"use strict";

const STREETCAR_LINES = [
  {
    id: "stcharles",
    name: "St. Charles",
    color: "#2E8B57",
    freq: "Every 10-15 min (peak), 20-30 min (off-peak)",
    hours: "24/7 (owl service overnight, every 30-60 min)",
    note: "Oldest continuously operating streetcar line in the world (since 1835). Runs from Canal St through the Garden District and Uptown to Carrollton.",
    route: [
      [29.9530,-90.0700],[29.9523,-90.0718],[29.9517,-90.0733],
      [29.9497,-90.0729],[29.9478,-90.0726],[29.9456,-90.0722],
      [29.9420,-90.0742],[29.9380,-90.0768],[29.9340,-90.0797],
      [29.9310,-90.0820],[29.9285,-90.0838],[29.9260,-90.0870],
      [29.9235,-90.0920],[29.9220,-90.0982],[29.9215,-90.1020],
      [29.9230,-90.1070],[29.9250,-90.1100],[29.9290,-90.1140],
      [29.9340,-90.1180],[29.9380,-90.1200],[29.9430,-90.1230],
      [29.9480,-90.1260],[29.9530,-90.1270],[29.9570,-90.1280],
      [29.9607,-90.1281]
    ],
    stops: [
      {name:"Canal & Carondelet", lat:29.9517, lon:-90.0733},
      {name:"Lee Circle", lat:29.9456, lon:-90.0722},
      {name:"St. Charles & Melpomene", lat:29.9380, lon:-90.0768},
      {name:"St. Charles & Jackson", lat:29.9285, lon:-90.0838},
      {name:"St. Charles & Louisiana", lat:29.9260, lon:-90.0870},
      {name:"St. Charles & Napoleon", lat:29.9220, lon:-90.0982},
      {name:"St. Charles & Jefferson", lat:29.9215, lon:-90.1020},
      {name:"St. Charles & Broadway", lat:29.9250, lon:-90.1100},
      {name:"Carrollton & Claiborne", lat:29.9570, lon:-90.1280},
      {name:"S. Carrollton & S. Claiborne", lat:29.9607, lon:-90.1281}
    ]
  },
  {
    id: "canal",
    name: "Canal Street",
    color: "#C62828",
    freq: "Every 15-20 min",
    hours: "5:00 AM - 1:00 AM daily",
    note: "Runs along Canal Street from the river to Mid-City. Splits into two branches: one to City Park/Museum and one to the Cemeteries.",
    route: [
      [29.9477,-90.0632],[29.9497,-90.0660],[29.9517,-90.0690],
      [29.9530,-90.0700],[29.9545,-90.0720],[29.9565,-90.0752],
      [29.9585,-90.0786],[29.9605,-90.0817],[29.9628,-90.0850],
      [29.9648,-90.0880],[29.9680,-90.0910],[29.9720,-90.0928],
      [29.9760,-90.0938],[29.9800,-90.0942],[29.9840,-90.0940],
      [29.9861,-90.0940]
    ],
    stops: [
      {name:"Canal & Bourbon", lat:29.9534, lon:-90.0706},
      {name:"Canal & Royal", lat:29.9530, lon:-90.0700},
      {name:"Canal & Rampart", lat:29.9545, lon:-90.0720},
      {name:"Canal & N. Broad", lat:29.9628, lon:-90.0850},
      {name:"Canal & Carrollton", lat:29.9680, lon:-90.0910},
      {name:"City Park / NOMA", lat:29.9861, lon:-90.0940}
    ]
  },
  {
    id: "riverfront",
    name: "Riverfront",
    color: "#7B1FA2",
    freq: "Every 20-30 min",
    hours: "7:00 AM - 10:30 PM daily",
    note: "Short scenic line along the Mississippi riverfront. Connects Canal Street to the French Market and Esplanade Ave. Great for a quick ride between the shopping district and the Market.",
    route: [
      [29.9477,-90.0632],[29.9490,-90.0628],[29.9510,-90.0620],
      [29.9530,-90.0608],[29.9550,-90.0600],[29.9570,-90.0594],
      [29.9590,-90.0590],[29.9610,-90.0597],[29.9625,-90.0605]
    ],
    stops: [
      {name:"Canal St / Aquarium", lat:29.9477, lon:-90.0632},
      {name:"Poydras St", lat:29.9490, lon:-90.0628},
      {name:"Julia St / Arts District", lat:29.9510, lon:-90.0620},
      {name:"French Market", lat:29.9590, lon:-90.0590},
      {name:"Esplanade Ave", lat:29.9625, lon:-90.0605}
    ]
  },
  {
    id: "rampart",
    name: "Rampart - St. Claude",
    color: "#00838F",
    freq: "Every 15-20 min",
    hours: "5:00 AM - 1:00 AM daily",
    note: "Connects Union Passenger Terminal (Amtrak) to the Marigny via Loyola Ave and N. Rampart St. Passes by Armstrong Park and the Treme neighborhood.",
    route: [
      [29.9460,-90.0782],[29.9480,-90.0770],[29.9497,-90.0755],
      [29.9517,-90.0740],[29.9540,-90.0726],[29.9555,-90.0714],
      [29.9570,-90.0700],[29.9585,-90.0686],[29.9600,-90.0672],
      [29.9620,-90.0650],[29.9635,-90.0630],[29.9650,-90.0605],
      [29.9664,-90.0580],[29.9675,-90.0555]
    ],
    stops: [
      {name:"Union Passenger Terminal", lat:29.9460, lon:-90.0782},
      {name:"Loyola & Poydras", lat:29.9480, lon:-90.0770},
      {name:"Canal & Elk Place", lat:29.9540, lon:-90.0726},
      {name:"N. Rampart & Conti", lat:29.9570, lon:-90.0700},
      {name:"N. Rampart & St. Philip (Armstrong Park)", lat:29.9600, lon:-90.0672},
      {name:"St. Claude & Elysian Fields", lat:29.9664, lon:-90.0580}
    ]
  }
];

const STREETCAR_FARE = {single:"$1.25", day:"$3.00 Jazzy Pass", senior:"$0.40"};

function nearestStop(lat, lon){
  let best = null, bestDist = Infinity;
  for(const line of STREETCAR_LINES){
    for(const stop of line.stops){
      const d = _scMeters([lat,lon],[stop.lat,stop.lon]);
      if(d < bestDist){ bestDist = d; best = {line, stop, meters: d}; }
    }
  }
  return best;
}

function nearestStopOnLine(lat, lon, lineId){
  const line = STREETCAR_LINES.find(l=>l.id===lineId);
  if(!line) return null;
  let best = null, bestDist = Infinity;
  for(const stop of line.stops){
    const d = _scMeters([lat,lon],[stop.lat,stop.lon]);
    if(d < bestDist){ bestDist = d; best = {line, stop, meters: d}; }
  }
  return best;
}

function stopsNearPlace(lat, lon, maxMeters){
  maxMeters = maxMeters || 800;
  const results = [];
  for(const line of STREETCAR_LINES){
    for(const stop of line.stops){
      const d = _scMeters([lat,lon],[stop.lat,stop.lon]);
      if(d <= maxMeters) results.push({line, stop, meters: d});
    }
  }
  results.sort((a,b)=>a.meters-b.meters);
  return results;
}

function walkMinutes(meters){
  return Math.max(1, Math.round(meters * 1.25 / 80));
}

function _scMeters(a,b){
  const r=x=>x*Math.PI/180, dLa=r(b[0]-a[0]), dLo=r(b[1]-a[1]);
  const s=Math.sin(dLa/2)**2+Math.cos(r(a[0]))*Math.cos(r(b[0]))*Math.sin(dLo/2)**2;
  return 2*6371000*Math.asin(Math.sqrt(s));
}

window.STREETCAR_LINES = STREETCAR_LINES;
window.STREETCAR_FARE = STREETCAR_FARE;
window.streetcarNearestStop = nearestStop;
window.streetcarNearestOnLine = nearestStopOnLine;
window.streetcarStopsNear = stopsNearPlace;
window.streetcarWalkMin = walkMinutes;

})();
