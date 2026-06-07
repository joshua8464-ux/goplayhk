import { httpsCallable } from 'firebase/functions';
import { functions } from '../config/firebase';

const getVenueWeatherCallable = httpsCallable(functions, 'getVenueWeather');

export const fetchVenueWeather = async ({ venueId, lat, lng }) => {
    const response = await getVenueWeatherCallable({ venueId, lat, lon: lng });
    return response.data;
};

export default fetchVenueWeather;