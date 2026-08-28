export interface FlightAirport {
  code: string;
  city: string;
  country: string;
  name: string;
  latitude: number;
  longitude: number;
}

export const CHANGI_AIRPORT: FlightAirport = {
  code: "SIN",
  city: "Singapore",
  country: "Singapore",
  name: "Singapore Changi Airport",
  latitude: 1.3644,
  longitude: 103.9915,
};

export const FLIGHT_DESTINATION_AIRPORTS: FlightAirport[] = [
  { code: "DPS", city: "Bali", country: "Indonesia", name: "I Gusti Ngurah Rai International Airport", latitude: -8.7482, longitude: 115.1672 },
  { code: "BKK", city: "Bangkok", country: "Thailand", name: "Suvarnabhumi Airport", latitude: 13.69, longitude: 100.7501 },
  { code: "HND", city: "Tokyo", country: "Japan", name: "Tokyo Haneda Airport", latitude: 35.5494, longitude: 139.7798 },
  { code: "ICN", city: "Seoul", country: "South Korea", name: "Incheon International Airport", latitude: 37.4602, longitude: 126.4407 },
  { code: "SYD", city: "Sydney", country: "Australia", name: "Sydney Kingsford Smith Airport", latitude: -33.9399, longitude: 151.1753 },
  { code: "DXB", city: "Dubai", country: "United Arab Emirates", name: "Dubai International Airport", latitude: 25.2532, longitude: 55.3657 },
  { code: "LHR", city: "London", country: "United Kingdom", name: "London Heathrow Airport", latitude: 51.47, longitude: -0.4543 },
  { code: "CDG", city: "Paris", country: "France", name: "Paris Charles de Gaulle Airport", latitude: 49.0097, longitude: 2.5479 },
  { code: "JFK", city: "New York", country: "United States", name: "John F. Kennedy International Airport", latitude: 40.6413, longitude: -73.7781 },
];

export const FLIGHT_AIRPORTS: FlightAirport[] = [CHANGI_AIRPORT, ...FLIGHT_DESTINATION_AIRPORTS];

export function searchAirports(query: string): FlightAirport[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return FLIGHT_AIRPORTS.slice(0, 6);
  return FLIGHT_AIRPORTS.filter((airport) =>
    [airport.code, airport.city, airport.country, airport.name]
      .some((value) => value.toLowerCase().includes(normalized)),
  ).slice(0, 6);
}

export function searchDestinationAirports(query: string): FlightAirport[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return FLIGHT_DESTINATION_AIRPORTS.slice(0, 5);
  return FLIGHT_DESTINATION_AIRPORTS.filter((airport) =>
    [airport.code, airport.city, airport.country, airport.name]
      .some((value) => value.toLowerCase().includes(normalized)),
  ).slice(0, 6);
}
