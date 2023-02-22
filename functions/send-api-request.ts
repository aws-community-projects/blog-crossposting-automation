import axios  from 'axios';
import { getSecret } from './utils/secrets';

export const handler = async (state: { secretKey: any; request: { method: any; baseUrl: any; headers: any; body: any; query: ArrayLike<unknown> | { [s: string]: unknown; }; }; auth: { prefix: any; location: string; key: string | number; }; }) => {
  const authToken = await getSecret(state.secretKey);
  if (!authToken) {
    throw new Error('Unable to get secret');
  }

  const config = getAxiosConfig(state, authToken);
  if (process.env.DRY_RUN === '1') {
    return {
      url: 'someUrl',
      data: {
        createPublicationStory: {
          post: {
            slug: 'someSlug'
          }
        }
      }
    };
  } else {
    console.log(JSON.stringify({ config, state }, null, 2));
    const response = await axios.request(config);
    return response.data;
  }
};

const getAxiosConfig = (state: { request: { method: any; baseUrl: any; headers: any; body: any; query: { [s: string]: unknown; } | ArrayLike<unknown>; }; auth: { prefix: any; location: string; key: string | number; }; }, authToken: string) => {
  const config = {
    method: state.request.method,
    baseURL: state.request.baseUrl,
    headers: state.request.headers ?? {},
    ...state.request.body && { data: state.request.body },
    responseType: 'json',
    validateStatus: (status: number) => status < 400
  };

  let authValue = authToken;
  if (state.auth.prefix) {
    authValue = `${state.auth.prefix} ${authToken}`;
  }

  if (state.auth.location == 'query') {
    config.baseURL = `${config.baseURL}?${state.auth.key}=${authValue}`;
  } else if (state.auth.location == 'header') {
    config.headers[state.auth.key] = authValue;
  }

  if (state.request.query) {
    const query = Object.entries(state.request.query).map(entry => `${entry[0]}=${entry[1]}`).join('&');
    if (config.baseURL.includes('?')) {
      config.baseURL = `${config.baseURL}&${query}`;
    } else {
      config.baseURL = `${config.baseURL}?${query}`;
    }
  }

  return config;
};