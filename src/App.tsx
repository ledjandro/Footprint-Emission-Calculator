import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, Polyline } from 'react-leaflet';
import { Leaf, Navigation, Search, Loader2, Car, Bus, Zap } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Fix for default marker icons in Leaflet with React
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
});

// Initialize Gemini AI
const GEMINI_API_KEY = "AIzaSyAlVaddDZPEljFsSzydrz7uKrGqo69Q1uU";
const GOOGLE_MAPS_API_KEY = "AIzaSyA8pRHkAHz2Zj45d2bTFwIt3V0F1PR9kA8";
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

interface Location {
  lat: number;
  lng: number;
  address: string;
}

interface EmissionResult {
  distance: number;
  emissions: number;
  transportType: string;
  aiFeedback?: string;
}

interface TransitInfo {
  mode: string;
  departure_stop: string;
  arrival_stop: string;
  transit_distance: string;
  walking_before?: string;
  walking_after?: string;
}

interface TransportType {
  id: string;
  name: string;
  emissionFactor: number; // grams of CO2 per km
  icon: React.ReactNode;
}

function App() {
  const [startLocation, setStartLocation] = useState<Location | null>(null);
  const [endLocation, setEndLocation] = useState<Location | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [result, setResult] = useState<EmissionResult | null>(null);
  const [isSelectingStart, setIsSelectingStart] = useState(true);
  const [startAddress, setStartAddress] = useState('');
  const [endAddress, setEndAddress] = useState('');
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTransportType, setSelectedTransportType] = useState<string>('gas-car');

  // Vancouver, BC coordinates
  const vancouverCoordinates = {
    lat: 49.2827,
    lng: -123.1207
  };

  const transportTypes: TransportType[] = [
    { id: 'gas-car', name: 'Gas Car', emissionFactor: 170, icon: <Car className="h-4 w-4" /> },
    { id: 'electric-car', name: 'Electric Car', emissionFactor: 128, icon: <Zap className="h-4 w-4" /> },
    { id: 'bus', name: 'Bus', emissionFactor: 31, icon: <Bus className="h-4 w-4" /> }
  ];

  // Get the selected transport type object
  const getSelectedTransportType = (): TransportType => {
    return transportTypes.find(type => type.id === selectedTransportType) || transportTypes[0];
  };

  // Function to get coordinates from address using Google Maps Geocoding API
  const getCoordinatesFromAddress = async (address: string): Promise<{lat: number, lng: number} | null> => {
    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_MAPS_API_KEY}`
      );
      const data = await response.json();
      
      if (data.status === "OK" && data.results.length > 0) {
        const location = data.results[0].geometry.location;
        return { lat: location.lat, lng: location.lng };
      } else {
        setError(`Could not find location: ${data.status}`);
        return null;
      }
    } catch (error) {
      console.error("Error fetching coordinates:", error);
      setError("Error fetching coordinates. Please try again.");
      return null;
    }
  };

  // Function to get address from coordinates using Google Maps Geocoding API
  const getAddressFromCoordinates = async (lat: number, lng: number): Promise<string> => {
    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}`
      );
      const data = await response.json();
      
      if (data.status === "OK" && data.results.length > 0) {
        return data.results[0].formatted_address;
      } else {
        return `Location at ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      }
    } catch (error) {
      console.error("Error fetching address:", error);
      return `Location at ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }
  };

  // Function to get route data from Google Maps Directions API
  const getRouteData = async (origin: Location, destination: Location): Promise<TransitInfo[] | null> => {
    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/directions/json?origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}&mode=transit&key=${GOOGLE_MAPS_API_KEY}`
      );
      const directions = await response.json();
      
      if (directions.status !== "OK" || !directions.routes || directions.routes.length === 0) {
        console.log("No transit routes found:", directions.status);
        // Don't set error here, just return null to allow fallback
        return null;
      }
      
      const travelData: TransitInfo[] = [];
      const route = directions.routes[0];
      
      for (const leg of route.legs) {
        for (let stepIndex = 0; stepIndex < leg.steps.length; stepIndex++) {
          const step = leg.steps[stepIndex];
          
          if (step.transit_details) {
            const transit = step.transit_details;
            const transitInfo: TransitInfo = {
              mode: transit.line.vehicle.name,
              departure_stop: transit.departure_stop.name,
              arrival_stop: transit.arrival_stop.name,
              transit_distance: step.distance.text
            };
            
            // Walking before transit
            if (stepIndex > 0 && leg.steps[stepIndex - 1].travel_mode.toLowerCase() === 'walking') {
              const walkingBefore = leg.steps[stepIndex - 1];
              transitInfo.walking_before = `${walkingBefore.distance.text} (Duration: ${walkingBefore.duration.text})`;
            }
            
            // Walking after transit
            if (stepIndex < leg.steps.length - 1 && leg.steps[stepIndex + 1].travel_mode.toLowerCase() === 'walking') {
              const walkingAfter = leg.steps[stepIndex + 1];
              transitInfo.walking_after = `${walkingAfter.distance.text} (Duration: ${walkingAfter.duration.text})`;
            }
            
            travelData.push(transitInfo);
          }
        }
      }
      
      return travelData.length > 0 ? travelData : null;
    } catch (error) {
      console.error("Error fetching route data:", error);
      // Don't set error here, just return null to allow fallback
      return null;
    }
  };

  // Function to get AI feedback using Gemini
  const getAIFeedback = async (travelData: TransitInfo[] | null, distance: number, transportType: TransportType): Promise<string> => {
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-pro" });
      
      let prompt = "Provide a detailed and insightful travel analysis based on the following information:\n\n";
      
      if (travelData && travelData.length > 0) {
        for (const step of travelData) {
          prompt += `🚍 Transit Mode: ${step.mode}\n`;
          prompt += `📏 Transit Distance: ${step.transit_distance}\n`;
          prompt += `🛑 Departure: ${step.departure_stop} ➡️ Arrival: ${step.arrival_stop}\n`;
          
          if (step.walking_before) {
            prompt += `🚶 Walking Before Transit: ${step.walking_before}\n`;
          }
          
          if (step.walking_after) {
            prompt += `🚶 Walking After Transit: ${step.walking_after}\n`;
          }
          
          prompt += "\n";
        }
      } else {
        // If no transit data, provide selected transport type info
        prompt += `🚗 Transport Type: ${transportType.name}\n`;
        prompt += `📏 Travel Distance: ${distance} km\n`;
        prompt += `💨 Emission Factor: ${transportType.emissionFactor} grams CO2 per km\n\n`;
      }
      
      prompt += `Total Distance: ${distance} km\n`;
      prompt += `Total Emissions: ${((distance * transportType.emissionFactor) / 1000).toFixed(2)} kg CO2\n\n`;
      prompt += "Provide an overall assessment of user's journey, considering efficiency and environmental impact based on the kilogram of CO2 emitted from using the transportation modes. Do not include infrastructure recommendations for improvement but include how can the user emit less emission by providing alternative routes or modes of transportation. Also present the kg of co2 emitted using the modes of transportation in a clean format followed by the feedback. Keep your response concise and under 200 words.";
      
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      
      return text;
    } catch (error) {
      console.error("Error getting AI feedback:", error);
      return "Unable to generate AI feedback at this time. Please try again later.";
    }
  };

  // Function to calculate emissions
  const calculateEmissions = async (start: Location, end: Location): Promise<EmissionResult> => {
    // Calculate distance using Haversine formula
    const lat1 = start.lat;
    const lon1 = start.lng;
    const lat2 = end.lat;
    const lon2 = end.lng;
    
    const R = 6371; // Radius of the earth in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = R * c; // Distance in km
    
    const transportType = getSelectedTransportType();
    
    // Calculate emissions based on selected transport type (convert from g to kg)
    const emissions = (distance * transportType.emissionFactor) / 1000;
    
    // Get transit route data
    const transitData = await getRouteData(start, end);
    
    // Get AI feedback
    setIsLoadingAI(true);
    const aiFeedback = await getAIFeedback(transitData, parseFloat(distance.toFixed(2)), transportType);
    setIsLoadingAI(false);
    
    return {
      distance: parseFloat(distance.toFixed(2)),
      emissions: parseFloat(emissions.toFixed(2)),
      transportType: transportType.name,
      aiFeedback
    };
  };

  const handleCalculate = async () => {
    if (startLocation && endLocation) {
      setIsCalculating(true);
      setError(null);
      try {
        const result = await calculateEmissions(startLocation, endLocation);
        setResult(result);
      } catch (error) {
        console.error('Error calculating emissions:', error);
        setError('Error calculating emissions. Please try again.');
      } finally {
        setIsCalculating(false);
      }
    }
  };

  const handleSearchAddress = async (isStart: boolean) => {
    const address = isStart ? startAddress : endAddress;
    if (!address) return;
    
    try {
      const coordinates = await getCoordinatesFromAddress(address);
      if (coordinates) {
        if (isStart) {
          setStartLocation({
            lat: coordinates.lat,
            lng: coordinates.lng,
            address: startAddress
          });
        } else {
          setEndLocation({
            lat: coordinates.lat,
            lng: coordinates.lng,
            address: endAddress
          });
        }
      }
    } catch (error) {
      console.error('Error searching address:', error);
      setError('Error searching address. Please try again.');
    }
  };

  const MapClickHandler = () => {
    useMapEvents({
      click: async (e) => {
        const { lat, lng } = e.latlng;
        const address = await getAddressFromCoordinates(lat, lng);
        
        if (isSelectingStart) {
          setStartLocation({ lat, lng, address });
          setStartAddress(address);
          setIsSelectingStart(false);
        } else {
          setEndLocation({ lat, lng, address });
          setEndAddress(address);
          setIsSelectingStart(true);
        }
      },
    });
    return null;
  };

  // Update input fields when locations change from map clicks
  useEffect(() => {
    if (startLocation) {
      setStartAddress(startLocation.address);
    }
  }, [startLocation]);

  useEffect(() => {
    if (endLocation) {
      setEndAddress(endLocation.address);
    }
  }, [endLocation]);

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden">
      {/* Animated gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-green-100 via-blue-50 to-green-50 z-0 animate-gradient-slow"></div>
      
      <header className="relative z-10 bg-white/80 backdrop-blur-sm shadow-md">
        <div className="container mx-auto px-4 py-4 flex items-center">
          <Leaf className="h-8 w-8 text-green-600 mr-2" />
          <h1 className="text-2xl font-bold text-green-800">Footprint: Emission Calculator</h1>
        </div>
      </header>

      <main className="flex-1 flex flex-col relative z-10">
        {/* Map Section - 60% of the screen */}
        <div className="h-[60vh] relative">
          <MapContainer 
            center={[vancouverCoordinates.lat, vancouverCoordinates.lng]} 
            zoom={13} 
            style={{ height: '100%', width: '100%' }}
            zoomControl={false}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MapClickHandler />
            
            {startLocation && (
              <Marker 
                position={[startLocation.lat, startLocation.lng]}
                draggable={true}
                eventHandlers={{
                  dragend: async (e) => {
                    const marker = e.target;
                    const position = marker.getLatLng();
                    const address = await getAddressFromCoordinates(position.lat, position.lng);
                    setStartLocation({
                      lat: position.lat,
                      lng: position.lng,
                      address
                    });
                    setStartAddress(address);
                  }
                }}
              >
                <Popup>Start: {startLocation.address}</Popup>
              </Marker>
            )}
            
            {endLocation && (
              <Marker 
                position={[endLocation.lat, endLocation.lng]}
                draggable={true}
                eventHandlers={{
                  dragend: async (e) => {
                    const marker = e.target;
                    const position = marker.getLatLng();
                    const address = await getAddressFromCoordinates(position.lat, position.lng);
                    setEndLocation({
                      lat: position.lat,
                      lng: position.lng,
                      address
                    });
                    setEndAddress(address);
                  }
                }}
              >
                <Popup>End: {endLocation.address}</Popup>
              </Marker>
            )}
            
            {startLocation && endLocation && (
              <Polyline 
                positions={[[startLocation.lat, startLocation.lng], [endLocation.lat, endLocation.lng]]}
                color="#4CAF50"
                weight={4}
                opacity={0.7}
              />
            )}
          </MapContainer>
          
          <div className="absolute top-4 right-4 bg-white/90 p-2 rounded-md shadow-md z-[1000]">
            <p className="text-sm text-gray-700">
              {isSelectingStart ? 'Click to set start point' : 'Click to set end point'}
            </p>
          </div>
        </div>

        {/* Controls Section */}
        <div className="flex-1 bg-white shadow-md rounded-t-3xl -mt-6 relative z-20">
          <div className="container mx-auto px-4 py-8 max-w-4xl">
            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg">
                {error}
              </div>
            )}
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div className="relative">
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Location</label>
                <div className="flex items-center">
                  <div className="absolute left-3 text-green-600">
                    <Navigation className="h-5 w-5" />
                  </div>
                  <input
                    type="text"
                    className="w-full pl-10 pr-12 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                    placeholder="Enter or select start point on map"
                    value={startAddress}
                    onChange={(e) => setStartAddress(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleSearchAddress(true);
                      }
                    }}
                  />
                  <button 
                    className="absolute right-2 p-1 text-gray-500 hover:text-green-600"
                    onClick={() => handleSearchAddress(true)}
                  >
                    <Search className="h-5 w-5" />
                  </button>
                </div>
              </div>
              
              <div className="relative">
                <label className="block text-sm font-medium text-gray-700 mb-1">End Location</label>
                <div className="flex items-center">
                  <div className="absolute left-3 text-blue-600">
                    <Navigation className="h-5 w-5" />
                  </div>
                  <input
                    type="text"
                    className="w-full pl-10 pr-12 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Enter or select end point on map"
                    value={endAddress}
                    onChange={(e) => setEndAddress(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleSearchAddress(false);
                      }
                    }}
                  />
                  <button 
                    className="absolute right-2 p-1 text-gray-500 hover:text-blue-600"
                    onClick={() => handleSearchAddress(false)}
                  >
                    <Search className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>
            
            {/* Transport Type Selection */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">Transport Type</label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {transportTypes.map((type) => (
                  <button
                    key={type.id}
                    className={`flex items-center justify-center p-3 rounded-lg border transition-all ${
                      selectedTransportType === type.id
                        ? 'bg-green-50 border-green-500 text-green-700 shadow-sm'
                        : 'border-gray-300 hover:border-green-300 hover:bg-green-50/50'
                    }`}
                    onClick={() => setSelectedTransportType(type.id)}
                  >
                    <span className="mr-2">{type.icon}</span>
                    <span className="font-medium">{type.name}</span>
                    <span className="ml-2 text-xs text-gray-500">({type.emissionFactor} g/km)</span>
                  </button>
                ))}
              </div>
            </div>
            
            <div className="flex justify-center mb-8">
              <button
                className={`flex items-center px-6 py-3 rounded-full text-white font-medium shadow-lg transition-all transform hover:scale-105 ${
                  startLocation && endLocation && !isCalculating
                    ? 'bg-gradient-to-r from-green-600 to-green-500 hover:from-green-700 hover:to-green-600'
                    : 'bg-gray-400 cursor-not-allowed'
                }`}
                onClick={handleCalculate}
                disabled={!startLocation || !endLocation || isCalculating}
              >
                {isCalculating ? (
                  <>
                    <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                    Calculating...
                  </>
                ) : (
                  <>
                    <Leaf className="h-5 w-5 mr-2" />
                    Calculate Emissions
                  </>
                )}
              </button>
            </div>
            
            {/* Results Section */}
            {result && (
              <div className="bg-gradient-to-r from-green-50 to-blue-50 rounded-xl p-6 shadow-md border border-green-100 transition-all duration-500 ease-in-out">
                <h2 className="text-xl font-semibold text-green-800 mb-4">Emission Results</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-white p-4 rounded-lg shadow-sm">
                    <p className="text-sm text-gray-500">Distance</p>
                    <p className="text-2xl font-bold text-blue-700">{result.distance} km</p>
                  </div>
                  <div className="bg-white p-4 rounded-lg shadow-sm">
                    <p className="text-sm text-gray-500">CO₂ Emissions</p>
                    <p className="text-2xl font-bold text-green-700">{result.emissions} kg</p>
                  </div>
                  <div className="bg-white p-4 rounded-lg shadow-sm">
                    <p className="text-sm text-gray-500">Transport Type</p>
                    <p className="text-2xl font-bold text-gray-700">{result.transportType}</p>
                  </div>
                </div>
                <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-100">
                  <h3 className="font-medium text-blue-800 mb-2">AI Eco Analysis:</h3>
                  {isLoadingAI ? (
                    <div className="flex items-center space-x-2 text-gray-600">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Generating AI feedback...</span>
                    </div>
                  ) : (
                    <div className="text-sm text-gray-600 whitespace-pre-line">
                      {result.aiFeedback}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
      
      <footer className="bg-white/80 backdrop-blur-sm py-4 relative z-10 border-t border-green-100">
        <div className="container mx-auto px-4 text-center text-sm text-gray-600">
          <p>Footprint - a project by group 1 biztech</p>
        </div>
      </footer>
    </div>
  );
}

export default App;