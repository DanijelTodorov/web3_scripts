import axios from 'axios';

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export const fetchAPI = async (url: string, method: string, data = {}) => {
    return new Promise(resolve => {
        if (method === "POST") {
            axios.post(url, data).then(response => {
                let json = response.data;
                resolve(json);
            }).catch(error => {
                // console.error('[fetchAPI]', error)
                resolve(null);
            });
        } else {
            axios.get(url).then(response => {
                let json = response.data;
                resolve(json);
            }).catch(error => {
                // console.error('fetchAPI', error);
                resolve(null);
            });
        }
    });
};