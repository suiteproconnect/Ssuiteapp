import { getRoomFromUrl, loadSuiteUser, saveSuiteUser } from './js/identity.js';
import { LobbyController } from './js/lobby.js';
import { initOneSignalAdapter } from './js/push.js';
import { RoomController } from './js/room-ui.js';
import { SocialController } from './js/social.js';

initOneSignalAdapter();

const rootEl = document.getElementById('root');

let user = loadSuiteUser();
const initialUrlRoom = getRoomFromUrl();
let activeRoom = initialUrlRoom
  ? { code: initialUrlRoom.code, pass: initialUrlRoom.pass, wantHost: false }
  : null;
let deferredPrompt = null;
let currentCtrl = null;
let activeView = 'lobby';
let socialInitialTab = 'discover';

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (currentCtrl && typeof currentCtrl.setDeferredPrompt === 'function') {
    currentCtrl.setDeferredPrompt(e);
  }
});

function mountActiveView() {
  if (!rootEl) return;
  if (currentCtrl) {
    currentCtrl.destroy();
    currentCtrl = null;
  }

  if (activeView === 'social' && user) {
    currentCtrl = new SocialController(rootEl, {
      user,
      initialTab: socialInitialTab,
      onClose: () => {
        activeView = 'lobby';
        mountActiveView();
      },
      onEnterRoom: (roomCode, roomName) => {
        activeView = 'room';
        enterRoom({ roomCode, name: user?.name || roomName, wantHost: false });
      },
    });
    return;
  }

  if (!activeRoom) {
    currentCtrl = new LobbyController(rootEl, {
      user,
      deferredPrompt,
      onOpenSocial: (tab = 'discover') => {
        socialInitialTab = tab;
        activeView = 'social';
        mountActiveView();
      },
      onUserChange: (nextUser) => {
        user = nextUser;
      },
      onEnterRoom: (opts) => enterRoom(opts),
    });
    return;
  }

  currentCtrl = new RoomController(rootEl, {
    initialRoomCode: activeRoom.code,
    initialPass: activeRoom.pass,
    initialName: activeRoom.name,
    wantHost: activeRoom.wantHost,
    suiteProfile: activeRoom.suiteProfile || null,
    user,
    onExitHome: exitHome,
    onNewRoom: (newCode, newPass) => {
      enterRoom({
        roomCode: newCode,
        pass: newPass,
        name: user?.name,
        wantHost: true,
      });
    },
    onUpdateUserName: (nextName) => {
      if (!user) return;
      user = { ...user, name: nextName };
      saveSuiteUser(user);
    },
  });
}

function enterRoom(opts) {
  activeView = 'room';
  const url = new URL(window.location.origin + window.location.pathname);
  url.searchParams.set('room', opts.roomCode);
  if (opts.pass) {
    url.searchParams.set('p', opts.pass);
  }
  window.history.pushState({}, '', url.toString());
  activeRoom = {
    code: opts.roomCode,
    pass: opts.pass,
    name: opts.name,
    wantHost: opts.wantHost,
    suiteProfile: opts.suiteProfile || null,
  };
  mountActiveView();
}

function exitHome() {
  activeView = 'lobby';
  const url = new URL(window.location.origin + window.location.pathname);
  window.history.pushState({}, '', url.toString());
  activeRoom = null;
  mountActiveView();
}

function syncFromUrl() {
  activeView = 'room';
  const urlRoom = getRoomFromUrl();
  activeRoom = urlRoom ? { code: urlRoom.code, pass: urlRoom.pass, wantHost: false } : null;
  mountActiveView();
}

window.addEventListener('popstate', syncFromUrl);
window.addEventListener('hashchange', syncFromUrl);

mountActiveView();
