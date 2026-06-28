export function createStyleElement(document, id) {
  if (document.getElementById(id)) return null;
  const parent = document.head || document.documentElement;
  if (!parent) return null;
  const style = document.createElement('style');
  style.id = id;
  parent.appendChild(style);
  return style;
}
