// Dove stanno i documenti di Business (contratti e fascicoli): su Azure Blob Storage quando l'archivio file della Suite è configurato,
// altrimenti nel database (colonna bytea). La logica è condivisa con gli altri moduli in server/src/lib/moduleStorage.js (prefisso
// "business" nei percorsi del blob); qui restano le stesse firme usate da routes/contracts.js, dossier.js, imports.js e admin.js.
import * as shared from '../../../lib/moduleStorage.js';

export const storageMode = shared.storageMode;
export const storeBuffer = (scope, filename, mime, buf) => shared.storeBuffer('business', scope, filename, mime, buf);
export const sendFile = shared.sendFile;
export const dropBlobs = (paths) => shared.dropBlobs('business', paths);
