
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js', {
    updateViaCache: 'none',
  });
}

var markersArray = []; //Used to keep track of other markers
var polyArray = []; //Used to keep track of lines
var labelArray = [];
var GridNorthtoMagneticNorthDeclination = 0;
var wminfowindow;
var uid;
var myOldLocation;
var dbLastUpdated = new Date();
dbLastUpdated.setMinutes(dbLastUpdated.getMinutes() - 10);
var GPSstarted;
var isMetric;

var bannedlist = ['list of sware words to filter out'];


let map;
let subscription;
let query;

const markers = {};
const radius = 150; // with a set radius in kilometers


// Query viewers' locations from Firestore
function queryFirestore(location) {
  if (subscription) {
    console.log('Old query subscription cancelled');
    subscription();
    subscription = false;
  }

  const geoquery = geocollection.near({
    center: new firebase.firestore.GeoPoint(location.lat, location.lng),
    radius: radius
  });

  console.log('New query subscription created');
  subscription = geoquery.onSnapshot((snapshot) => {
    console.log(snapshot.docChanges())
    snapshot.docChanges().forEach((change) => {
      switch (change.type) {
        case 'added':
          console.log('Snapshot detected added marker');
          return addMarker(change.doc.id, change.doc.data());
        case 'modified':
          console.log('Snapshot detected modified marker');
          return updateMarker(change.doc.id, change.doc.data());
        case 'removed':
          console.log('Snapshot detected removed marker');
          return removeMarker(change.doc.id, change.doc.data());
        default:
          break;
      }
    });
  });
}


function editDBKey(key) {
  markers[key]["infowindow"].close();
  console.log(markers[key]["text"]);
  var dialog = document.querySelector('#editDialog');
  if (!dialog.showModal) { dialogPolyfill.registerDialog(dialog); };
  dialog.showModal();
  document.getElementById('markerTitleEdit').parentElement.MaterialTextfield.change(markers[key]["title"]);
  document.getElementById('markerTextEdit').parentElement.MaterialTextfield.change(markers[key]["text"]);
  document.getElementById("markerid").value = key;
}

function saveEditedNote(key) {
  document.querySelector('#editDialog').close()
  var key = document.getElementById("markerid").value;
  console.log(key);

  geocollection.doc('channels').collection('public').doc(key).set({
    title: document.getElementById("markerTitleEdit").value,
    text: document.getElementById("markerTextEdit").value,
    channel: 'public',
    type: 'note',
    updated: new firebase.firestore.Timestamp.now()
  }, { merge: true }).then(() => {
    console.log('Provided key has been changed in GeoFirestore');
  }, (error) => {
    console.log('Error: ' + error);
    showMessage('Failed ' + error, 2);
  });
}

function removeDBKey(key) {
  geocollection.doc('channels').collection('public').doc(key).delete().then(() => {
    console.log('Provided key has been removed from GeoFirestore');
  }, (error) => {
    console.log('Error: ' + error);
    showMessage('Failed ' + error, 2);
  });
}

function getTimeDifference(myDoc) {
  var now = new firebase.firestore.Timestamp.now().toDate();

  var milisec_diff = now - myDoc.updated.toDate();
  console.log(now);
  console.log(myDoc.updated.toDate());

  var secDiff = milisec_diff / 1000; //in s
  var minDiff = milisec_diff / 60 / 1000; //in minutes
  var hDiff = milisec_diff / 3600 / 1000; //in hours
  var humanReadable = {};
  humanReadable.hours = Math.floor(hDiff);
  humanReadable.minutes = minDiff - 60 * humanReadable.hours;
  var diff = '';
  if (humanReadable.hours > 0) {
    diff += parseInt(humanReadable.hours).toString() + "h ";
  }
  if (humanReadable.minutes > 0) {
    diff += parseInt(humanReadable.minutes).toString() + "s ";
  }

  console.log(diff);
  return 'Updated ' + diff + ' ago.';
}

function BuildContentString(key, myDoc) {
  var myLat = myDoc.coordinates.latitude;
  var myLon = myDoc.coordinates.longitude;
  var uuid = myDoc.uid;
  var diff = getTimeDifference(myDoc);

  var positionDetails = '';
  positionDetails += (myDoc.accuracy != null) ? 'Accuracy: ' + formatDistance(myDoc.accuracy) + '<br>' : ''
  positionDetails += (myDoc.altitude != null) ? 'Altitude: ' + formatDistance(myDoc.altitude) + '<br>' : ''
  positionDetails += (myDoc.speed != null) ? 'Speed: ' + formatSpeed(myDoc.speed) + '<br>' : ''
  positionDetails += (!isNaN(parseInt(myDoc.heading))) ? 'Heading: ' + parseInt(myDoc.heading).toString() + '<br>' : ''

  var contentString = `
  <div id="content"><i class="material-icons ">person</i><b>${myDoc.title}</b><br>
  <button class="mdl-button mdl-js-button mdl-button--icon mdl-button--colored" onclick="getDistance(${myLat},${myLon});return false;"><i class="material-icons">explore</i></button>
  <button class="mdl-button mdl-js-button mdl-button--icon mdl-button--colored" onclick="calcRoute(${myLat},${myLon});return false;"><i class="material-icons">route</i></button>
  <button class="mdl-button mdl-js-button mdl-button--icon mdl-button--colored" onclick="map.setZoom(10);return false;"><i class="material-icons">zoom_out_map</i></button>
  <button class="mdl-button mdl-js-button mdl-button--icon mdl-button--colored" onclick="var latLng = new google.maps.LatLng(${myLat},${myLon});map.panTo(latLng);map.setZoom(17);return false;"><i class="material-icons">zoom_in_map</i></button>
  ${myDoc.text || ''}<br><i>
  ${positionDetails || ''}
  <small>${diff}</small></i>
</div>
  `;
  return contentString;
}


function BuildLi(key, myDoc, listIconType) {
  var listIconType;

  switch (myDoc.type) {
    case 'user':
      listIconType = 'person'
      break;
    case 'note':
      if (myDoc.uid == uid) {
        listIconType = 'mode_comment'
      } else {
        listIconType = 'speaker_notes'
      }
      break;
    case 'photo':
      listIconType = 'photo'
      break;
    case 'event':
      listIconType = 'event_note'
      break;
    case 'waypoint':
      listIconType = 'speaker_notes'
      break;
    default:
      listIconType = 'speaker_notes'
  }

  var now = new firebase.firestore.Timestamp.now().toDate();
  var milisec_diff = now - myDoc.updated.toDate();

  if (milisec_diff > 3600000) {
    listIconType = 'person_outline'
  } else {
    listIconType = 'person'
  }

  var li = document.createElement("li");
  li.className = "mdl-list__item mdl-list__item--two-line";
  li.id = key;
  var span = document.createElement("span");
  span.className = "mdl-list__item-primary-content";

  var i2 = document.createElement("i");
  i2.className = "material-icons mdl-list__item-avatar";
  i2.append(document.createTextNode(listIconType));
  span.append(i2);

  var spanAction = document.createElement("span");
  spanAction.append(document.createTextNode(myDoc.title));
  span.append(spanAction);

  var diff = getTimeDifference(myDoc);
  var spanSubItem = document.createElement("span");
  spanSubItem.className = "mdl-list__item-sub-title";
  spanSubItem.append(document.createTextNode(diff));
  span.append(spanSubItem);

  li.append(span);
  li.addEventListener("click", (e) => {
    console.log(markers[key]["infowindow"]);
    document.querySelector('.mdl-layout').MaterialLayout.toggleDrawer();
    document.getElementById("tab-1").click();
    componentHandler.upgradeDom();
    componentHandler.upgradeAllRegistered();
    if (document.getElementById("list-switch-2").checked) {
      document.getElementById('list-switch-2').click();
    }
    google.maps.event.trigger(markers[key], 'click')
  })

  return li;
}

// Add Marker to Google Maps
function addMarker(key, myDoc) {
  if (key == uid) {
    return;
  }

  var now = new firebase.firestore.Timestamp.now().toDate();
  var milisec_diff = now - myDoc.updated.toDate();
  if (milisec_diff > 14400000) {
    return;
  }

  if (!markers[key]) {

    markers[key] = new google.maps.Marker({
      position: {
        lat: myDoc.coordinates.latitude,
        lng: myDoc.coordinates.longitude
      },
      map: map
    });

    var infowindowContent;
    switch (myDoc.type) {
      case 'user':
        markers[key].setIcon('images/alien.png');
        infowindowContent = BuildContentString(key, myDoc);
        // infowindowContent = myDoc.title;
        break;
      case 'note':
        if (myDoc.uid == uid) {
          markers[key].setIcon('images/comment.png');
        } else {
          markers[key].setIcon('images/comment-map-icon.png');
        }
        infowindowContent = BuildContentString(key, myDoc);
        break;
      case 'photo':
        markers[key].setIcon('images/text.png');
        break;
      case 'event':
        markers[key].setIcon('images/text.png');
        break;
      case 'waypoint':
        markers[key].setIcon('images/text.png');
        break;
      default:
        markers[key].setIcon('images/information.png');
        infowindowContent = BuildContentString(key, myDoc);
    }
    // Color: 577382
    var now = new firebase.firestore.Timestamp.now().toDate();
    var milisec_diff = now - myDoc.updated.toDate();

    if (milisec_diff > 3600000) {
      markers[key].setIcon('images/marker-gray.png');
    } else {
      markers[key].setIcon('images/red.png');
    }

    var infowindow = new google.maps.InfoWindow({
      content: infowindowContent
    });

    markers[key].set("title", myDoc.title);
    markers[key].set("text", myDoc.text);
    markers[key].set("infowindow", infowindow);

    markers[key].addListener('click', function () {
      infowindow.open(map, markers[key]);
      setTimeout(function () { infowindow.close(); }, 25000); // how long do you want the delay to be?
    });

  }

  var ul = document.getElementById("contactList");

  if (!document.getElementById(key)) {
    ul.append(BuildLi(key, myDoc));
  } else {
    document.getElementById(key).replaceWith(BuildLi(key, myDoc));
  }
  document.getElementById("count").setAttribute('data-badge', ul.childNodes.length - 1);
  if (ul.childNodes.length > 1) {
    document.getElementById('contactListEmpty').setAttribute('hidden', 'true');
  } else {
    document.getElementById('contactListEmpty').removeAttribute('hidden');
  }

}

// Remove Marker to Google Maps
function removeMarker(key) {
  if (markers[key]) {
    google.maps.event.clearListeners(markers[key], 'click');
    markers[key].setMap(null);
    markers[key] = null;
    if (document.getElementById(key)) {
      document.getElementById(key).remove();
      var ul = document.getElementById("contactList");
      document.getElementById("count").setAttribute('data-badge', ul.childNodes.length - 1);
      if (ul.childNodes.length > 1) {
        document.getElementById('contactListEmpty').setAttribute('hidden', 'true');
      } else {
        document.getElementById('contactListEmpty').removeAttribute('hidden');
      }
    }
  }
}

// Update Marker on Google Maps
function updateMarker(key, myDoc) {

  if (markers[key]) {
    var infowindow = new google.maps.InfoWindow({
      content: BuildContentString(key, myDoc)
    });

    markers[key].setPosition({
      lat: myDoc.coordinates.latitude,
      lng: myDoc.coordinates.longitude
    });
    markers[key].set("title", myDoc.title);
    markers[key].set("text", myDoc.text);

    google.maps.event.clearListeners(markers[key], 'click');

    markers[key].addListener('click', function () {
      infowindow.open(map, markers[key]);
    });

    if (document.getElementById(key)) {
      document.getElementById(key).replaceWith(BuildLi(key, myDoc));
    } else {
      console.log('Missing updated element ' + key);
    }

  } else {
    addMarker(key, myDoc);
  }
}




initApp = function () {

  firebase.auth().onAuthStateChanged(function (user) {
    if (user) {
      // User is signed in.
      var isAnonymous = user.isAnonymous;
      uid = user.uid;
    } else {
      showMessage('Signed out', 1);
    }
    // ...
  });

  firebase.auth().signInAnonymously().catch(function (error) {
    // Handle Errors here.
    var errorCode = error.code;
    var errorMessage = error.message;
    showMessage(errorMessage, 1);
  });

  if (getSavedValue('display-name', '') !== '') {
    document.getElementById('display-name').value = getSavedValue('display-name', '');
    document.getElementById('display-name').parentElement.classList.add('is-dirty');
  } else {
    var tempName = Math.random().toString(36).substring(2, 15).toUpperCase();
    document.getElementById('display-name').value = tempName
    localStorage.setItem('display-name', document.getElementById('display-name').value);
    document.getElementById('display-name').parentElement.classList.add('is-dirty');
  }
  showMessage('Your display name is: ' + document.getElementById('display-name').value, 0);
  document.getElementById('text-decl').value = getSavedValue('decl', 0);
  document.getElementById('text-decl').parentElement.classList.add('is-dirty');
  if (getSavedValue('isMetric', 'true') === 'false') {
    isMetric = false;
    document.getElementById('option-2').click();
    document.getElementById('option-2').parentElement.classList.add('is-dirty');
  } else {
    isMetric = true;
  }

  setTimeout(function () { document.getElementById('list-switch-1').click(); }, 3500);

};


window.addEventListener('load', function () {
  initApp()
});


var styles = {
  default: null,
  silver: [
    {
      elementType: 'geometry',
      stylers: [{ color: '#f5f5f5' }]
    },
    {
      elementType: 'labels.icon',
      stylers: [{ visibility: 'off' }]
    },
    {
      elementType: 'labels.text.fill',
      stylers: [{ color: '#616161' }]
    },
    {
      elementType: 'labels.text.stroke',
      stylers: [{ color: '#f5f5f5' }]
    },
    {
      featureType: 'administrative.land_parcel',
      elementType: 'labels.text.fill',
      stylers: [{ color: '#bdbdbd' }]
    },
    {
      featureType: 'poi',
      elementType: 'geometry',
      stylers: [{ color: '#eeeeee' }]
    },
    {
      featureType: 'poi',
      elementType: 'labels.text.fill',
      stylers: [{ color: '#757575' }]
    },
    {
      featureType: 'poi.park',
      elementType: 'geometry',
      stylers: [{ color: '#e5e5e5' }]
    },
    {
      featureType: 'poi.park',
      elementType: 'labels.text.fill',
      stylers: [{ color: '#9e9e9e' }]
    },
    {
      featureType: 'road',
      elementType: 'geometry',
      stylers: [{ color: '#ffffff' }]
    },
    {
      featureType: 'road.arterial',
      elementType: 'labels.text.fill',
      stylers: [{ color: '#757575' }]
    },
    {
      featureType: 'road.highway',
      elementType: 'geometry',
      stylers: [{ color: '#dadada' }]
    },
    {
      featureType: 'road.highway',
      elementType: 'labels.text.fill',
      stylers: [{ color: '#616161' }]
    },
    {
      featureType: 'road.local',
      elementType: 'labels.text.fill',
      stylers: [{ color: '#9e9e9e' }]
    },
    {
      featureType: 'transit.line',
      elementType: 'geometry',
      stylers: [{ color: '#e5e5e5' }]
    },
    {
      featureType: 'transit.station',
      elementType: 'geometry',
      stylers: [{ color: '#eeeeee' }]
    },
    {
      featureType: 'water',
      elementType: 'geometry',
      stylers: [{ color: '#c9c9c9' }]
    },
    {
      featureType: 'water',
      elementType: 'labels.text.fill',
      stylers: [{ color: '#9e9e9e' }]
    }
  ],

  night: [
    { elementType: 'geometry', stylers: [{ color: '#242f3e' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#242f3e' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#746855' }] },
    {
      featureType: 'administrative.locality',
      elementType: 'labels.text.fill',
      stylers: [{ color: '#d59563' }]
    },
    {
      featureType: 'poi',
      elementType: 'labels.text.fill',
      stylers: [{ color: '#d59563' }]
    },
    {
      featureType: 'poi.park',
      elementType: 'geometry',
      stylers: [{ color: '#263c3f' }]
    },
    {
      featureType: 'poi.park',
      elementType: 'labels.text.fill',
      stylers: [{ color: '#6b9a76' }]
    },
    {
      featureType: 'road',
      elementType: 'geometry',
      stylers: [{ color: '#38414e' }]
    },
    {
      featureType: 'road',
      elementType: 'geometry.stroke',
      stylers: [{ color: '#212a37' }]
    },
    {
      featureType: 'road',
      elementType: 'labels.text.fill',
      stylers: [{ color: '#9ca5b3' }]
    },
    {
      featureType: 'road.highway',
      elementType: 'geometry',
      stylers: [{ color: '#746855' }]
    },
    {
      featureType: 'road.highway',
      elementType: 'geometry.stroke',
      stylers: [{ color: '#1f2835' }]
    },
    {
      featureType: 'road.highway',
      elementType: 'labels.text.fill',
      stylers: [{ color: '#f3d19c' }]
    },
    {
      featureType: 'transit',
      elementType: 'geometry',
      stylers: [{ color: '#2f3948' }]
    },
    {
      featureType: 'transit.station',
      elementType: 'labels.text.fill',
      stylers: [{ color: '#d59563' }]
    },
    {
      featureType: 'water',
      elementType: 'geometry',
      stylers: [{ color: '#17263c' }]
    },
    {
      featureType: 'water',
      elementType: 'labels.text.fill',
      stylers: [{ color: '#515c6d' }]
    },
    {
      featureType: 'water',
      elementType: 'labels.text.stroke',
      stylers: [{ color: '#17263c' }]
    }
  ],

  retro: [
    { elementType: 'geometry', stylers: [{ color: '#ebe3cd' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#523735' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#f5f1e6' }] },
    {
      featureType: 'administrative',
      elementType: 'geometry.stroke',
      stylers: [{ color: '#c9b2a6' }]
    },
    {
      featureType: 'administrative.land_parcel',
      elementType: 'geometry.stroke',
      stylers: [{ color: '#dcd2be' }]
    },
    {
      featureType: 'administrative.land_parcel',
      elementType: 'labels.text.fill',
      stylers: [{ color: '#ae9e90' }]
    },
    {
      featureType: 'landscape.natural',
      elementType: 'geometry',
      stylers: [{ color: '#dfd2ae' }]
    },
    {
      featureType: 'poi',
      elementType: 'geometry',
      stylers: [{ color: '#dfd2ae' }]
    },
    {
      featureType: 'poi',
      elementType: 'labels.text.fill',
      stylers: [{ color: '#93817c' }]
    },
    {
      featureType: 'poi.park',
      elementType: 'geometry.fill',
      stylers: [{ color: '#a5b076' }]
    },
    {
      featureType: 'poi.park',
      elementType: 'labels.text.fill',
      stylers: [{ color: '#447530' }]
    },
    {
      featureType: 'road',
      elementType: 'geometry',
      stylers: [{ color: '#f5f1e6' }]
    },
    {
      featureType: 'road.arterial',
      elementType: 'geometry',
      stylers: [{ color: '#fdfcf8' }]
    },
    {
      featureType: 'road.highway',
      elementType: 'geometry',
      stylers: [{ color: '#f8c967' }]
    },
    {
      featureType: 'road.highway',
      elementType: 'geometry.stroke',
      stylers: [{ color: '#e9bc62' }]
    },
    {
      featureType: 'road.highway.controlled_access',
      elementType: 'geometry',
      stylers: [{ color: '#e98d58' }]
    },
    {
      featureType: 'road.highway.controlled_access',
      elementType: 'geometry.stroke',
      stylers: [{ color: '#db8555' }]
    },
    {
      featureType: 'road.local',
      elementType: 'labels.text.fill',
      stylers: [{ color: '#806b63' }]
    },
    {
      featureType: 'transit.line',
      elementType: 'geometry',
      stylers: [{ color: '#dfd2ae' }]
    },
    {
      featureType: 'transit.line',
      elementType: 'labels.text.fill',
      stylers: [{ color: '#8f7d77' }]
    },
    {
      featureType: 'transit.line',
      elementType: 'labels.text.stroke',
      stylers: [{ color: '#ebe3cd' }]
    },
    {
      featureType: 'transit.station',
      elementType: 'geometry',
      stylers: [{ color: '#dfd2ae' }]
    },
    {
      featureType: 'water',
      elementType: 'geometry.fill',
      stylers: [{ color: '#b9d3c2' }]
    },
    {
      featureType: 'water',
      elementType: 'labels.text.fill',
      stylers: [{ color: '#92998d' }]
    }
  ],

  hiding: [
    {
      featureType: 'poi.business',
      stylers: [{ visibility: 'off' }]
    },
    {
      featureType: 'transit',
      elementType: 'labels.icon',
      stylers: [{ visibility: 'off' }]
    }
  ]
};

var snackbarContainer = document.querySelector('#my-snackbar');

var handler = function (event) {
  snackbarContainer.MaterialSnackbar.dismiss;
  snackbarContainer.classList.remove('mdl-snackbar--active');
  snackbarContainer.setAttribute("aria-hidden", "true");
};


function showMessage(myMessage, myErrorType) {
  console.log(myMessage);
  var data = {
    message: myMessage,
    actionHandler: handler,
    actionText: 'OK'
  };
  console.log(myErrorType);
  if (myErrorType == 2) {
    var snackbarContainer = document.querySelector('#my-error-snackbar');
    document.querySelector('#my-snackbar-icon').innerHTML = 'error';
    snackbarContainer.style.backgroundColor = 'rgba(255, 0, 0, .95)';
    console.log('error');
  } else if (myErrorType == 1) {
    var snackbarContainer = document.querySelector('#my-error-snackbar');
    document.querySelector('#my-snackbar-icon').innerHTML = 'warning';
    snackbarContainer.style.backgroundColor = 'rgba(255, 153, 0, .95)';
    console.log('warning');
  } else if (myErrorType == 7) {
    var snackbarContainer = document.querySelector('#my-snackbar');
    snackbarContainer.style.backgroundColor = 'rgba(96,125,139,.95)';
    data.timeout = 7000;
    console.log('other');
  } else {
    var snackbarContainer = document.querySelector('#my-snackbar');
    data.timeout = 3000;
    snackbarContainer.style.backgroundColor = 'rgba(7,91,137,.95)';
    console.log('other');
  }
  snackbarContainer.MaterialSnackbar.showSnackbar(data);
}

var showMessagenew = (function () {
  var previous = null;

  return function (message, actionText, action) {
    if (previous) {
      previous.dismiss();
    }
    var snackbar = document.createElement('div');
    snackbar.className = 'paper-snackbar';
    snackbar.dismiss = function () {
      this.style.opacity = 0;
    };
    var text = document.createTextNode(message);
    snackbar.appendChild(text);
    if (actionText) {
      if (!action) {
        action = snackbar.dismiss.bind(snackbar);
      }
      var actionButton = document.createElement('button');
      actionButton.className = 'action';
      actionButton.innerHTML = actionText;
      actionButton.addEventListener('click', action);
      snackbar.appendChild(actionButton);
    }
    setTimeout(function () {
      if (previous === this) {
        previous.dismiss();
      }
    }.bind(snackbar), 5000);

    snackbar.addEventListener('transitionend', function (event, elapsed) {
      if (event.propertyName === 'opacity' && this.style.opacity == 0) {
        this.parentElement.removeChild(this);
        if (previous === this) {
          previous = null;
        }
      }
    }.bind(snackbar));



    previous = snackbar;
    document.querySelector('#main_content').appendChild(snackbar);
    // In order for the animations to trigger, I have to force the original style to be computed, and then change it.
    getComputedStyle(snackbar).bottom;
    snackbar.style.bottom = '0px';
    snackbar.style.opacity = 1;
  };
})();


function setNight() {
  map.setOptions({ styles: styles['night'] });
  showMessage('Night colors ON', 0);
}
function setDay() {
  map.setOptions({ styles: styles['retro'] });
  showMessage('Day colors ON', 0);
}

var mapTypeIds = [];
var locationMarker;
var workingMarker
var image;

function getSavedValue(myItem, myDefault) {
  try {
    var myValue = localStorage.getItem(myItem);
    if (myValue !== null) {
      return myValue;
    } else {
      return myDefault;
    }
  }
  catch (err) {
    console.log(err.message);
  }
}



function initMap() {
  var mapCenter;
  var centerLat = parseFloat(getSavedValue('lat', 52.078874));
  var centerLng = parseFloat(getSavedValue('lng', 4.312620));

  var centerLatLng = {
    lat: centerLat,
    lng: centerLng
  };

  var myLatLng = {
    lat: parseFloat(getSavedValue('mylat', centerLat)),
    lng: parseFloat(getSavedValue('mylng', centerLng))
  };

  map = new google.maps.Map(document.getElementById('map-page'), {
    zoom: parseInt(getSavedValue('zoom', 17)),
    minZoom: 4,
    center: centerLatLng,
    disableDefaultUI: true,
    panControl: false,
    zoomControl: false,
    mapTypeControl: false,
    scaleControl: false,
    streetViewControl: false,
    overviewMapControl: true,
    mapTypeId: getSavedValue('maptypeid', 'terrain')
  });
  map.setOptions({ styles: styles['retro'] });

  map.mapTypes.set("OSM", new google.maps.ImageMapType({
    getTileUrl: function (coord, zoom) {
      var tilesPerGlobe = 1 << zoom;
      var x = coord.x % tilesPerGlobe;
      if (x < 0) {
        x = tilesPerGlobe + x;
      }

      return "https://tile.openstreetmap.org/" + zoom + "/" + x + "/" + coord.y + ".png";
    },
    tileSize: new google.maps.Size(256, 256),
    name: "OpenStreetMap",
    maxZoom: 18
  }));


  locationMarker = new google.maps.Marker({
    clickable: false,
    icon: {
      path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
      strokeColor: '#075b9e',
      fillColor: '#2196f3',
      fillOpacity: 1,
      strokeWeight: 2,
      scale: 5,
      origin: new google.maps.Point(-2.5, 0),
      anchor: new google.maps.Point(0, 2.5)
    },
    shadow: null,
    zIndex: 999,
    position: myLatLng,
    map: map,
    title: "Saved Position",
    draggable: false,
  });

  myCircle = new google.maps.Circle({
    map: map,
    radius: 1, 
    strokeColor: '#0099FF',
    strokeOpacity: 0.7,
    fillColor: '#AA0000',
    fillOpacity: 0.2,
    strokeWeight: 0.5
  });
  myCircle.bindTo('center', locationMarker, 'position');

  google.maps.event.addListener(locationMarker, 'dragend', function (locationMarker) {
    myCircle.setRadius(50);
    myCircle.setOptions({ fillColor: '#333333' });
    var latLng = locationMarker.latLng;
    myLat = latLng.lat();
    myLon = latLng.lng();
    console.log(myLat);
    console.log(myLon);
  });



  map.addListener('idle', function () {
    var getCenter = map.getCenter()
    var center = {
      lat: getCenter.lat(),
      lng: getCenter.lng()
    };

    localStorage.setItem('lat', map.getCenter().lat());
    localStorage.setItem('lng', map.getCenter().lng());
    var pos = getCenter; 
    var center2 = new google.maps.LatLng(getCenter.lat(), getCenter.lng());
    if (!mapCenter || google.maps.geometry.spherical.computeDistanceBetween(mapCenter, center2).toFixed(1) > (radius * 700)) {
      if (uid != null) {
        mapCenter = center2;
        queryFirestore(center);
      }
    }
  });

  map.addListener('zoom_changed', function () {
    localStorage.setItem('zoom', map.getZoom());
  });

  map.addListener('maptypeid_changed', function () {
    localStorage.setItem('maptypeid', map.getMapTypeId());
  });

  var infowindow = new google.maps.InfoWindow({ maxWidth: 400 });

  function geocodeLatLng(location, title, body) {
    var geocoder = new google.maps.Geocoder;
    var input = location;
    var latlngStr = input.split(',', 2);
    var latlng = { lat: parseFloat(latlngStr[0]), lng: parseFloat(latlngStr[1]) };
    geocoder.geocode({ 'location': latlng }, function (results, status) {
      if (status === google.maps.GeocoderStatus.OK) {
        if (results[1]) {
          var marker = new google.maps.Marker({
            position: latlng,
            map: map
          });

          marker.addListener('click', function () {
            infowindow.setContent("<h3>" + title + "</h3>" + "<p>" + body + "</p>");
            infowindow.open(map, marker);
          });

        } else {
          showMessage('No results found', 2);

        }
      } else {
        window.alert('Geocoder failed due to: ' + status);
        showMessage('Geocoder failed due to: ' + status, 2);
      }
    });
  }

  document.getElementById('spinner').setAttribute('hidden', true);
  componentHandler.upgradeDom();
  componentHandler.upgradeAllRegistered();
} (function () {
  'use strict';
  var showToastButton = document.querySelector('#get-noaa');
  showToastButton.addEventListener('click', function () {
    document.getElementById('main_content').setAttribute('hidden', true);
    document.getElementById('spinner').removeAttribute('hidden');
    lookupMag();
  });
}());

var watchID;
function successCallback(position) {
  console.log(position);
  var myAccuracy = position.coords.accuracy;
  var pos = new google.maps.LatLng(position.coords.latitude, position.coords.longitude);
  locationMarker.setPosition(pos);

  var myHeading = position.coords.heading;
  if (!isNaN(parseInt(myHeading))) {
    var locationIcon = locationMarker.get('icon');
    locationIcon.rotation = myHeading;
    locationMarker.set('icon', locationIcon);
  }

  if (document.getElementById("list-switch-2").checked) {
    map.panTo(locationMarker.getPosition());
  }

  if (myAccuracy < 300) {
    myCircle.setRadius(myAccuracy / 2);
    myCircle.setOptions({ fillColor: '#33CCFF' });
    document.getElementById("gps-icon").innerHTML = "gps_fixed";
    document.getElementById("gps-warning").setAttribute("style", "display:none;");;
    document.getElementById("gps-icon").style.backgroundColor = "transparent";
  } else {
    myCircle.setRadius(300);
    myCircle.setOptions({ fillColor: '#CC3300' });
    document.getElementById("gps-icon").innerHTML = "gps_not_fixed";
    document.getElementById("gps-icon").style.backgroundColor = "#dd2c00";
    document.getElementById("gps-warning").removeAttribute("style", "display:none;");
  }

  document.getElementById('text-lat').value = position.coords.latitude;
  document.getElementById('text-lon').value = position.coords.longitude;
  document.getElementById('text-alt').value = formatDistance(position.coords.altitude);
  document.getElementById('text-acc').value = formatDistance(position.coords.accuracy);
  document.getElementById('text-spd').value = formatSpeed(position.coords.speed);
  document.getElementById('text-hea').value = (isNaN(parseInt(position.coords.heading))) ? '' : parseInt(position.coords.heading).toString();
  document.getElementById('text-upd').value = parseTimestamp(position.timestamp);
  localStorage.setItem('mylat', position.coords.latitude);
  localStorage.setItem('mylng', position.coords.longitude);

  //Turn OFF the GPS if it has been ON for more then 1h
  var endDate = new Date();
  var seconds = (endDate.getTime() - GPSstarted.getTime()) / 1000;
  if (seconds > 3600) {
    console.log('Auto GPS OFF');
    document.getElementById('list-switch-1').click();
  }


  if (!myOldLocation || google.maps.geometry.spherical.computeDistanceBetween(myOldLocation, pos).toFixed(1) > 100.0) {
    // computeDistanceBetween Returns the distance, in meters, between two LatLngs. You can optionally specify a custom radius. The radius defaults to the radius of the Earth.
    myOldLocation = pos;
    console.log('moved, updating');

    if (getSavedValue('display-name', '') == '') {
      document.getElementById("tab-3").click();
      showMessage('Enter a display name', 1);
      return '';
    }
    geocollection.doc(uid).set({
      title: document.getElementById("display-name").value,
      accuracy: position.coords.accuracy,
      altitude: position.coords.altitude,
      timestamp: position.timestamp,
      speed: position.coords.speed,
      heading: position.coords.heading,
      type: 'user',
      uid: uid,
      coordinates: new firebase.firestore.GeoPoint(position.coords.latitude, position.coords.longitude),
      updated: new firebase.firestore.Timestamp.now()
    }, { merge: true }).then(() => {
      console.log('Provided key has been changed in GeoFirestore');
      dbLastUpdated = new Date();
    }, (error) => {
      console.log('Error: ' + error);
      showMessage('Failed ' + error, 1);
    });

  } else {
    // If GPS is ON but we haven't moved for > 5 minutes, update timestamp
    var endDate = new Date();
    var seconds = (endDate.getTime() - dbLastUpdated.getTime()) / 1000;
    if (seconds > 300) {
      geocollection.doc(uid).set({
        updated: new firebase.firestore.Timestamp.now()
      }, { merge: true }).then(() => {
        console.log('5 min - position updated');
        dbLastUpdated = new Date();
      }, (error) => {
        console.log('Error: ' + error);
        showMessage('Failed', 1);
      });
    }


  }
}

function setdecl(v) {
  console.log("declination found: " + v);
  var declination = Math.round(v.replace(/(\r\n|\n|\r)/gm, ""));
  document.getElementById('main_content').removeAttribute('hidden');
  document.getElementById('spinner').setAttribute('hidden', true);
  document.getElementById('text-decl').value = declination;
  showMessage('NOAA', 0);
}


function lookupMag(n) {
  var myLat = locationMarker.getPosition().lat();
  var myLon = locationMarker.getPosition().lng();
  var year = new Date().getFullYear();
  var alt = parseInt(document.getElementById('text-alt').value);
  if (isNaN(alt)) { alt = 0; };

  var url = "https://geomag.amentum.io/wmm/magnetic_field?altitude=" + alt + "&latitude=" + myLat + "&longitude=" + myLon + "&year=" + year;
  var xmlhttp = new XMLHttpRequest();

  xmlhttp.onreadystatechange = function () {
    if (xmlhttp.readyState == XMLHttpRequest.DONE) { 
      document.getElementById('main_content').removeAttribute('hidden');
      document.getElementById('spinner').setAttribute('hidden', true);
      if (xmlhttp.status == 200) {
        var json = JSON.parse(xmlhttp.responseText);
        console.log(json.declination.value);
        var declination = json.declination.value;
        document.getElementById('text-decl').value = declination;
        document.getElementById('text-decl').parentElement.classList.add('is-dirty');
        GridNorthtoMagneticNorthDeclination = declination;
        myScript();
        showMessage('Updated declination value')
      }
      else if (xmlhttp.status == 400) {
        showMessage('Error, could not retrieve declination', '');
      }
      else {
        showMessage('Error, could not retrieve declination', '');
      }
    }
  };

  xmlhttp.open("GET", url, true);
  xmlhttp.setRequestHeader("api-key", "<redacted>");
  xmlhttp.send();
}

document.getElementById('text-decl').addEventListener("change", myScript);
function myScript() {
  console.log(document.getElementById('text-decl').value);
  localStorage.setItem('decl', document.getElementById('text-decl').value);
}

document.getElementById('display-name').addEventListener("change", myScript2);
function myScript2() {
  console.log(document.getElementById('display-name').value);
  filteredContent = document.getElementById('display-name').value
  for (var i = 0; i < bannedlist.length; i++) {
    var pattern = new RegExp(bannedlist[i], 'gi');
    var clean = ''.repeat(bannedlist[i].length);
    filteredContent = filteredContent.replace(pattern, clean);
  }
  console.log(filteredContent);
  if (filteredContent.trim() == '') {
    filteredContent = Math.random().toString(36).substring(2, 15).toUpperCase();
  }
  document.getElementById('display-name').value = filteredContent.trim();
  document.getElementById('display-name').parentElement.classList.add('is-dirty');
  localStorage.setItem('display-name', document.getElementById('display-name').value);
}


function formatDistance(myDistance) {
  var myValue = parseFloat(myDistance);
  if (isNaN(myValue)) {
    return '';
  }
  if (document.getElementById("option-1").checked) {
    isMetric = true;
  } else {
    isMetric = false;
  }
  if (isMetric) {
    if (myValue > 1000) {
      myValue = myValue / 1000
      return myValue.toFixed(2).toString() + ' km';
    } else {
      return parseInt(myValue).toString() + ' m';
    }
  } else {
    if (myValue > 1000) {
      myValue = myValue / 1609.34
      return myValue.toFixed(2).toString() + ' mi';
    } else {
      return parseInt(myValue * 3.28084).toString() + ' ft';
    }
  }
}

function formatSpeed(myDistance) {
  var myValue = parseFloat(myDistance);
  if (isNaN(myValue)) {
    return '';
  }
  if (document.getElementById("option-1").checked) {
    isMetric = true;
  } else {
    isMetric = false;
  }
  if (isMetric) {
    if (myValue > 5) {
      myValue = myValue / 3.6
      return myValue.toFixed(2).toString() + ' km/h';
    } else {
      return myValue.toFixed(2).toString() + ' m/s';
    }
  } else {
    if (myValue > 5) {
      myValue = myValue / 2.23694
      return myValue.toFixed(2).toString() + ' mi/h';
    } else {
      return (myValue / 3.28084).toFixed(2).toString() + ' ft/s';
    }
  }
}


function listenForPositionUpdates() {
  // Check whether browser supports Geolocation API or not
  if (navigator.geolocation) // Supported
  {
    var positionOptions = {
      timeout: Infinity,
      maximumAge: 0,
      enableHighAccuracy: true
    };
    // Set the watchID
    watchID = navigator.geolocation.watchPosition(successCallback, catchError, positionOptions);
    GPSstarted = new Date();
    showMessage("GPS ON", 0);
  }
  else // Not supported
  {
    showMessage("Oop! This browser does not support HTML5 Geolocation.", 1);
  }
}


function catchError(error) {
  switch (error.code) {
    case error.TIMEOUT:
      showMessage("The request to get user location has aborted as it has taken too long.", 1);
      break;
    case error.POSITION_UNAVAILABLE:
      showMessage("Location information is not available.", 1);
      break;
    case error.PERMISSION_DENIED:
      showMessage("Permission to share location information has been denied!", 1);
      break;
    default:
      showMessage("An unknown error occurred.", 1);
  }
  document.getElementById('list-switch-1').click();
}



var toggleSwitch = document.getElementById("list-switch-1");
toggleSwitch.addEventListener('click', function (event) {
  var targetElement = event.target || event.srcElement;
  console.log(targetElement.id);
  console.log(targetElement.checked);
  if (targetElement.checked) {
    listenForPositionUpdates();

  } else {
    document.getElementById("gps-icon").innerHTML = "gps_off";
    document.getElementById("gps-icon").style.backgroundColor = "#dd2c00";
    document.getElementById("gps-warning").removeAttribute("style", "display:none;");

    if (watchID != null) {
      window.navigator.geolocation.clearWatch(watchID);
      watchID = null;
      console.log('clear watch');
      showMessage('GPS OFF, no longer receiving updates.', 1)
      myCircle.setRadius(50);
      myCircle.setOptions({ fillColor: '#333333' });
      if (subscription) {
        console.log('Query subscription cancelled');
        subscription();
        subscription = false;
      }
    }
  }
});

var toggleSwitch = document.getElementById("list-switch-2");
toggleSwitch.addEventListener('click', function (event) {
  var targetElement2 = event.target || event.srcElement;
  console.log(targetElement2.id);
  console.log(targetElement2.checked);
  if (targetElement2.checked) {
    document.getElementById("center-icon").innerHTML = "location_on";
  } else {
    document.getElementById("center-icon").innerHTML = "location_off";
  }
});

function changeMetric() {
  if (document.getElementById("option-1").checked) {
    localStorage.setItem('isMetric', true);
    isMetric = true;
  } else {
    localStorage.setItem('isMetric', false);
    isMetric = false;
  }
}


function getDateString() {
  var objToday = new Date(),
    weekday = new Array('Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'),
    dayOfWeek = weekday[objToday.getDay()],
    domEnder = function () { var a = objToday.getDate(); return 1 == a ? "st" : 2 == a ? "nd" : 3 == a ? "rd" : "th" }(),
    dayOfMonth = today + (objToday.getDate() < 10) ? '0' + objToday.getDate() + domEnder : objToday.getDate() + domEnder,
    months = new Array('January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'),
    curMonth = months[objToday.getMonth()],
    curYear = objToday.getFullYear(),
    curHour = objToday.getHours() > 12 ? objToday.getHours() - 12 : (objToday.getHours() < 10 ? "0" + objToday.getHours() : objToday.getHours()),
    curMinute = objToday.getMinutes() < 10 ? "0" + objToday.getMinutes() : objToday.getMinutes(),
    curSeconds = objToday.getSeconds() < 10 ? "0" + objToday.getSeconds() : objToday.getSeconds(),
    curMeridiem = objToday.getHours() > 12 ? "PM" : "AM";
  var today = dayOfWeek + " " + curMonth + " " + dayOfMonth + "<br>" + curHour + ":" + curMinute + "." + curSeconds + curMeridiem;
  return today
}

function parseTimestamp(timestamp) {
  var d = new Date(timestamp);
  var day = d.getDate();
  var month = d.getMonth() + 1;
  var year = d.getFullYear();
  var hour = d.getHours();
  var mins = d.getMinutes();
  var secs = d.getSeconds();
  var msec = d.getMilliseconds();
  return year + "-" + month + "-" + day + " " + hour + ":" + mins + ":" + secs + "." + msec;
}

function guid() {
  return s4() + '-' + s4()
}

function s4() {
  return Math.floor((1 + Math.random()) * 0x10000)
    .toString(16)
    .substring(1);
}

function calcRoute(markerLat, markerLon) {
  var myLat = locationMarker.getPosition().lat();
  var myLon = locationMarker.getPosition().lng();
  var start = new google.maps.LatLng(myLat, myLon);
  var end = new google.maps.LatLng(markerLat, markerLon);

  const directionsService = new google.maps.DirectionsService();
  const directionsRenderer = new google.maps.DirectionsRenderer({
    suppressMarkers: true
  });

  var request = {
    origin: start,
    destination: end,
    unitSystem: isMetric ? google.maps.UnitSystem.METRIC : google.maps.UnitSystem.IMPERIAL,
    travelMode: google.maps.TravelMode.WALKING,
  };

  directionsService.route(request, function (result, status) {
    if (status == google.maps.DirectionsStatus.OK) {
      try {
        directionsRenderer.setDirections(result);
        var lang = 'From: ' + result.routes[0].legs[0].start_address + '<br/>To: ' + result.routes[0].legs[0].end_address + '<br/><br/>';
        lang += 'Distance: ' + result.routes[0].legs[0].distance.text + ", " + result.routes[0].legs[0].duration.text + "<br/><br />";
        for (x = 0; x < result.routes[0].legs[0].steps.length; x++) {
          lang += result.routes[0].legs[0].steps[x].instructions;
          lang += " (" + result.routes[0].legs[0].steps[x].distance.text + ") <br />";
        }
        var dialog = document.querySelector('#popupGeoLocation');
        document.getElementById("directions").innerHTML = lang;
        directionsRenderer.setMap(map);
        setTimeout(function () { directionsRenderer.setMap(null); }, 35000);
        dialog.showModal();
      }
      catch (err) {
        console.log(err.message);
        showMessage(err.message);
      }

    } else {
      showMessage('Failed to get directions. ' + status);
    }
  });
}

function getDistance(markerLat, markerLon) {
  var start = new google.maps.LatLng(locationMarker.getPosition().lat(), locationMarker.getPosition().lng());
  var end = new google.maps.LatLng(markerLat, markerLon);
  const lineSymbol = {
    path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
  };
  var myTrip = [start, end];
  var flightPath = new google.maps.Polyline({
    path: myTrip,
    strokeColor: "#075b9e",
    strokeOpacity: 0.8,
    strokeWeight: 2,
    icons: [
      {
        icon: lineSymbol,
        offset: "100%",
      },
    ],
  });
  flightPath.setMap(map);

  var distance = google.maps.geometry.spherical.computeDistanceBetween(start, end).toFixed(1);
  var heading = google.maps.geometry.spherical.computeHeading(start, end).toFixed(1);
  if (heading < 0) {
    heading = (parseFloat(heading) + parseFloat(360)).toFixed(1);
  }
  heading = parseInt(heading);
  GridNorthtoMagneticNorthDeclination = parseFloat(document.getElementById('text-decl').value)
  var CompassHead = parseFloat(heading) + parseFloat(GridNorthtoMagneticNorthDeclination);
  if (CompassHead > 360) {
    CompassHead = (parseFloat(CompassHead) - parseFloat(360));
  }
  if (CompassHead < 0) {
    CompassHead = (parseFloat(CompassHead) + parseFloat(360));
  }
  CompassHead = parseInt(CompassHead);
  var myText = "Distance: " + formatDistance(distance) + " - Heading: Grid " + heading + "°  Compass " + CompassHead + "°";

  console.log(myText);

  var new_boundary = new google.maps.LatLngBounds();
  new_boundary.extend(start);
  new_boundary.extend(end);
  map.fitBounds(new_boundary);
  setTimeout(function () { flightPath.setMap(null); }, 25000);
  showMessage(myText, 7);
}
