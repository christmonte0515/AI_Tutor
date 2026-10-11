const defaultServer = (window.appConfig && window.appConfig.serverUrl) || window.location.origin;

export const state = {
  server: localStorage.getItem('serverUrl') || defaultServer,
  // Kept in memory only, so closing the app signs the student out (shared lab computers).
  token: null,
  user: null,
  conversations: [],
  domains: [],
  current: null,
  streaming: null,
};

export { defaultServer };
