// Shows one language's blocks: every element whose lang differs from the chosen one is hidden by the #lang-rule style.
(function () {
  var KEY = "briefing-lang";

  function show(lang) {
    var root = document.documentElement;
    root.dataset.lang = lang;
    root.lang = lang;
    document.getElementById("lang-rule").textContent = 'body [lang]:not([lang="' + lang + '"]) { display: none !important; }';
  }

  var stored = "en";
  try { stored = localStorage.getItem(KEY) || "en"; } catch (e) {}
  show(/^[a-z]{2,3}(-[a-z0-9]+)*$/i.test(stored) ? stored : "en");

  document.addEventListener("DOMContentLoaded", function () {
    var select = document.getElementById("lang-select");
    var current = document.documentElement.dataset.lang;
    var offered = Array.prototype.some.call(select.options, function (option) { return option.value === current; });
    if (!offered) show(current = "en");
    select.value = current;
    select.addEventListener("change", function () {
      show(select.value);
      try { localStorage.setItem(KEY, select.value); } catch (e) {}
    });
  });
})();
