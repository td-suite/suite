// Registro dei moduli travasati (front-end), scoperto automaticamente dalle cartelle web/src/modules/<key>/.
// Ogni modulo ha:
//   meta.js   (caricato subito, piccolo): export default { key, title, kicker, area, nav: [{ to, icon, label, end?, group?, profiles? }] }
//   index.jsx (caricato a richiesta): default = componente con le <Routes> relative del modulo
// Il CSS del modulo (qualunque .css nella sua cartella) viene isolato dal plugin Vite sotto .mod-<key>.
const metas = import.meta.glob('./*/meta.js', { eager: true });
const loaders = import.meta.glob('./*/index.jsx');

export const MODULES = {};
for (const [p, m] of Object.entries(metas)) {
  const key = p.split('/')[1];
  const loader = loaders[`./${key}/index.jsx`];
  if (!loader) continue;
  MODULES[key] = { ...(m.default || {}), key, load: loader };
}
export const moduleKeys = () => Object.keys(MODULES);
export const moduleFor = (pathname) => { const k = pathname.split('/')[1]; return MODULES[k] || null; };
