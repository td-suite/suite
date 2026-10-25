// Suite TD · mostra la barra "Suite TD · Home" solo a chi è entrato dalla Suite (cookie suite_origin=1 impostato dalla rotta SSO)
(function () {
  var bar = document.getElementById('suite-bar');
  if (!bar) return;
  if (/(^|;\s*)suite_origin=1(;|$)/.test(document.cookie)) bar.hidden = false;
  var close = document.getElementById('suite-bar-close');
  if (close) close.addEventListener('click', function () { document.cookie = 'suite_origin=; Max-Age=0; path=/'; bar.hidden = true; });
})();
