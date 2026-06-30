import axios from 'axios';
import { getAccessToken } from './auth.js';
import { AppError } from '../utils/errors.js';

const nombaClient = axios.create({
    baseURL: process.env.NOMBA_BASE_URL || 'https://api.nomba.com',
    timeout: 30000,
});

nombaClient.interceptors.request.use(async (config) => {
    const token = await getAccessToken();
    config.headers.Authorization = `Bearer ${token}`;
    // Every Nomba endpoint requires the parent account ID in this header
    config.headers.accountId = process.env.NOMBA_ACCOUNT_ID;
    return config;
});

nombaClient.interceptors.response.use(
    (response) => {
        if (response.data?.code !== '00') {
            throw new AppError(
                `Nomba API error: ${response.data?.message || 'Unknown error'}`,
                'NOMBA_ERROR',
                502,
            );
        }
        return response;
    },
    (err) => {
        const msg =
            err.response?.data?.message || err.message || 'Nomba unavailable';
        throw new AppError(`Nomba API error: ${msg}`, 'NOMBA_ERROR', 502);
    },
);

export default nombaClient;
