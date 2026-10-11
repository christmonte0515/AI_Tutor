let signOutHandler = () => {};

export function registerSignOut(handler) {
  signOutHandler = handler;
}

export function signOut(message) {
  signOutHandler(message);
}
