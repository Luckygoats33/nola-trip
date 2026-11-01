/* New Orleans Movie & TV Filming Locations
   Curated spots where tourists can visit and retake iconic shots */

(function(){
"use strict";

var MOVIE_LOCATIONS = [
  {movie:"The Curious Case of Benjamin Button", year:2008, scene:"The Nolan House where Benjamin ages in reverse, the film's central setting.", loc:"Nolan House (private, exterior only)", addr:"2707 Coliseum St", lat:29.9235, lon:-90.0858, tip:"Stand across Coliseum St for the full facade framed by oak trees."},
  {movie:"Interview with the Vampire", year:1994, scene:"Lestat's elegant French Quarter townhouse where he and Louis live as vampires.", loc:"Gallier House Museum", addr:"1132 Royal St", lat:29.9582, lon:-90.0636, tip:"Shoot from the opposite sidewalk to capture the iron balcony and full three-story facade."},
  {movie:"Interview with the Vampire", year:1994, scene:"Louis walks the atmospheric gaslit alley brooding over his immortality.", loc:"Pirate's Alley", addr:"beside St. Louis Cathedral", lat:29.9578, lon:-90.0635, tip:"Walk to the middle of the alley and shoot toward the Cathedral for the moody corridor framing."},
  {movie:"A Streetcar Named Desire", year:1951, scene:"Blanche DuBois rides the streetcar named Desire to her sister's apartment.", loc:"St. Charles Streetcar Line", addr:"Canal St & Carondelet", lat:29.9517, lon:-90.0733, tip:"Board the green St. Charles car and photograph from the wooden seat looking out the open window."},
  {movie:"Double Jeopardy", year:1999, scene:"Libby's fake funeral is held among the above-ground tombs.", loc:"Lafayette Cemetery No. 1", addr:"1427 Washington Ave", lat:29.9273, lon:-90.0855, tip:"Enter the main Washington Ave gate and shoot down the center aisle toward the back wall of crypts."},
  {movie:"JFK", year:1991, scene:"Garrison's investigation headquarters and trial scenes in the historic Greek Revival building.", loc:"Gallier Hall", addr:"545 St. Charles Ave", lat:29.9456, lon:-90.0722, tip:"Stand on the neutral ground of St. Charles Ave facing the columned portico."},
  {movie:"Girls Trip", year:2017, scene:"The Flossy Posse parties on Bourbon Street with Hand Grenade drinks.", loc:"Bourbon Street at Tropical Isle", addr:"600 Bourbon St", lat:29.9567, lon:-90.0679, tip:"Stand at the Bourbon & Toulouse intersection and shoot down the neon-lit street at dusk."},
  {movie:"Girls Trip", year:2017, scene:"The ladies check into the glamorous hotel and explore the ornate Sazerac Bar.", loc:"The Roosevelt Hotel", addr:"130 Roosevelt Way", lat:29.9528, lon:-90.0710, tip:"Photograph the long gilded lobby corridor from the entrance looking toward the Sazerac Bar."},
  {movie:"Now You See Me", year:2013, scene:"The Four Horsemen magicians cause chaos near Jackson Square and escape through the French Market.", loc:"Cafe Du Monde", addr:"800 Decatur St", lat:29.9575, lon:-90.0618, tip:"Grab a table under the green-and-white awning and frame the beignets with Jackson Square behind you."},
  {movie:"NCIS: New Orleans", year:2014, scene:"Pride's team gathers intel in Jackson Square, a backdrop throughout all seven seasons.", loc:"Jackson Square", addr:"700 Decatur St", lat:29.9574, lon:-90.0631, tip:"Stand at the Decatur entrance with St. Louis Cathedral centered behind the Andrew Jackson statue."},
  {movie:"American Horror Story: Coven", year:2013, scene:"Madame LaLaurie's mansion of horrors, the show's most infamous real-life location.", loc:"LaLaurie Mansion (private, exterior only)", addr:"1140 Royal St", lat:29.9622, lon:-90.0637, tip:"Photograph from across Royal St at the Gov. Nicholls corner to capture the full gray facade."},
  {movie:"Deja Vu", year:2006, scene:"The ferry explosion that kills hundreds of Navy sailors, the crime Denzel investigates.", loc:"Canal Street Ferry Terminal", addr:"Foot of Canal St at the River", lat:29.9467, lon:-90.0632, tip:"Stand on the upper deck of the Algiers Ferry for the same river and skyline angle."},
  {movie:"Live and Let Die", year:1973, scene:"Bond witnesses a jazz funeral procession that turns into a wild street chase.", loc:"Bourbon & St. Peter", addr:"Bourbon St & St. Peter St", lat:29.9568, lon:-90.0660, tip:"Stand at the corner where the second line parade scene was filmed."},
  {movie:"12 Years a Slave", year:2013, scene:"Early scenes with the hotel doubling for a Northern city.", loc:"The Columns Hotel", addr:"3811 St. Charles Ave", lat:29.9210, lon:-90.0930, tip:"Stand on the neutral ground across St. Charles to capture the white columned Victorian porch."},
  {movie:"The Princess and the Frog", year:2009, scene:"Tiana's dream restaurant and the bayou scenes draw from these real locations.", loc:"City Park (Cafe Du Monde kiosk)", addr:"1 Collins C Diboll Cir", lat:29.9862, lon:-90.0967, tip:"Visit the City Park Cafe Du Monde kiosk surrounded by live oaks that inspired the bayou."},
  {movie:"Treme (HBO)", year:2010, scene:"Opening credits and countless scenes feature the park entrance and Congo Square.", loc:"Louis Armstrong Park", addr:"835 N Rampart St", lat:29.9610, lon:-90.0672, tip:"Enter through the main arch on N. Rampart and photograph the iron gateway with the park beyond."},
  {movie:"The Big Easy", year:1986, scene:"Remy McSwain takes the DA through the Quarter on a romantic night out.", loc:"Napoleon House", addr:"500 Chartres St", lat:29.9558, lon:-90.0645, tip:"Grab a Pimm's Cup at the bar and shoot the crumbling plaster walls. The courtyard is the scene."},
  {movie:"Django Unchained", year:2012, scene:"Candyland plantation exterior filmed at this historic estate.", loc:"Evergreen Plantation", addr:"4677 Hwy 18, Edgard", lat:29.9800, lon:-90.6967, tip:"The oak-lined path to the main house is the Candyland approach. Morning light is best.", daytrip:true},
  {movie:"Interview with the Vampire", year:1994, scene:"The vampire ball and aristocratic parlor scenes were filmed inside this 1850s mansion.", loc:"Oak Alley Plantation", addr:"3645 Hwy 18, Vacherie", lat:29.9939, lon:-90.7764, tip:"Walk the quarter-mile oak canopy for the iconic tunnel shot at golden hour.", daytrip:true}
];

window.MOVIE_LOCATIONS = MOVIE_LOCATIONS;

})();
