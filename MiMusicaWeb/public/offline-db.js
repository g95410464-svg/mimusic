let opening;
function openDatabase() {
  return opening ||= new Promise((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open('mimusic-offline-v1', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('settings');
      db.createObjectStore('tracks', { keyPath: 'key' }).createIndex('account', 'account');
      db.createObjectStore('audio'); db.createObjectStore('covers');
    };
    request.onerror = () => { opening = null; reject(request.error); };
    request.onblocked = () => { blocked = true; opening = null; reject(new Error('Cierra las otras pestañas de mimusic y vuelve a intentarlo.')); };
    request.onsuccess = () => { const db = request.result; if (blocked) { db.close(); return; } db.onversionchange = () => { db.close(); opening = null; }; resolve(db); };
  });
}
async function transaction(stores, mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode); let value;
    tx.oncomplete = () => resolve(value);
    tx.onabort = tx.onerror = () => reject(tx.error || new Error('No se pudo guardar la descarga.'));
    try { operation(tx, result => { value = result; }); }
    catch (error) { tx.abort(); reject(error); }
  });
}
const read = (store, key) => transaction([store], 'readonly', (tx, done) => {
  const request = tx.objectStore(store).get(key); request.onsuccess = () => done(request.result);
});
export const offlineDB = {
  account: () => read('settings', 'activeAccount'),
  activate: account => transaction(['settings'], 'readwrite', tx => tx.objectStore('settings').put(account, 'activeAccount')),
  list: account => transaction(['tracks'], 'readonly', (tx, done) => {
    const request = tx.objectStore('tracks').index('account').getAll(account); request.onsuccess = () => done(request.result);
  }),
  put: (record, audio, cover) => transaction(['tracks', 'audio', 'covers'], 'readwrite', tx => {
    tx.objectStore('audio').put(audio, record.key);
    if (cover) tx.objectStore('covers').put(cover, record.key);
    tx.objectStore('tracks').put(record);
  }),
  remove: key => transaction(['tracks', 'audio', 'covers'], 'readwrite', tx => {
    for (const store of ['tracks', 'audio', 'covers']) tx.objectStore(store).delete(key);
  }),
  audio: key => read('audio', key), cover: key => read('covers', key)
};
