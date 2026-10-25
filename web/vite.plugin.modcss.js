// Plugin Vite: isola il CSS dei moduli travasati (web/src/modules/<key>/**/*.css) sotto .mod-<key>, così le classi delle app
// di origine (.card, .btn, .shell ...) non entrano in conflitto con quelle della Suite né tra moduli.
import postcss from 'postcss';

export default function moduleCss() {
  return {
    name: 'td-module-css',
    enforce: 'pre',
    async transform(code, id) {
      const m = /[\\/]src[\\/]modules[\\/]([a-z_]+)[\\/].*\.css(\?.*)?$/.exec(id);
      if (!m) return null;
      const prefix = `.mod-${m[1]}`;
      const root = postcss.parse(code);
      root.walkRules((rule) => {
        if (rule.parent && rule.parent.type === 'atrule' && /keyframes/i.test(rule.parent.name)) return;
        rule.selectors = rule.selectors.map((sel) => {
          const s = sel.trim();
          if (/^(:root|html|body)(\b|$)/.test(s)) return s.replace(/^(:root|html|body)/, prefix);
          if (s.startsWith(prefix)) return s;
          return `${prefix} ${s}`;
        });
      });
      return { code: root.toString(), map: null };
    },
  };
}
