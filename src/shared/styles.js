export function createStyleElement(document, id) {
  if (document.getElementById(id)) return null;
  const style = document.createElement('style');
  style.id = id;
  document.head.appendChild(style);
  return style;
}
