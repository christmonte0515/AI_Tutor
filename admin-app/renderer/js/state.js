const defaultServer = (window.appConfig && window.appConfig.serverUrl) || window.location.origin;

export const state = {
  server: localStorage.getItem('serverUrl') || defaultServer,
  token: null,
  user: null,
  catalog: [],
  students: [],
  selected: new Set(),
  editing: null,
  prompts: { offset: 0, limit: 50, total: 0 },
};

export { defaultServer };
