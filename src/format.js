// Helpers puros de formato y tipos de archivo.

/** Escapa texto para insertarlo en HTML, tanto en contenido como en atributos */
export const esc = s => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export const fmtSize = b =>
  b < 1024         ? b + ' B'
  : b < 1048576    ? (b / 1024).toFixed(1)       + ' KB'
  : b < 1073741824 ? (b / 1048576).toFixed(2)    + ' MB'
  :                  (b / 1073741824).toFixed(2) + ' GB';

/** Extensión en minúsculas, sin punto ('' si no tiene) */
export const extOf = name => {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
};

const ICONS = {
  jpg:'fa-file-image', jpeg:'fa-file-image', png:'fa-file-image', gif:'fa-file-image',
  webp:'fa-file-image', bmp:'fa-file-image', heic:'fa-file-image', svg:'fa-file-image',
  pdf:'fa-file-pdf',
  mp4:'fa-file-video', mkv:'fa-file-video', avi:'fa-file-video', mov:'fa-file-video', webm:'fa-file-video',
  mp3:'fa-file-audio', wav:'fa-file-audio', flac:'fa-file-audio', ogg:'fa-file-audio', aac:'fa-file-audio',
  zip:'fa-file-zipper', rar:'fa-file-zipper', '7z':'fa-file-zipper', gz:'fa-file-zipper',
  doc:'fa-file-word',  docx:'fa-file-word',  xls:'fa-file-excel', xlsx:'fa-file-excel',
  js:'fa-file-code',   ts:'fa-file-code',    py:'fa-file-code',
  html:'fa-file-code', css:'fa-file-code',   json:'fa-file-code',
  txt:'fa-file-lines', md:'fa-file-lines',   csv:'fa-file-lines', log:'fa-file-lines',
};
export const getIcon = n => 'fas ' + (ICONS[extOf(n)] || 'fa-file');
export const isImg   = n => /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(n);
export const isTxt   = n => /\.(txt|md|json|js|ts|py|html|css|log|csv|xml|sh|bat|c|cpp|h|java|rb|php)$/i.test(n);
export const isVideo = n => /\.(mp4|webm|mkv|avi|mov|ogv|m4v)$/i.test(n);
export const isAudio = n => /\.(mp3|wav|flac|ogg|aac|m4a|opus|weba)$/i.test(n);
export const isPdf   = n => /\.pdf$/i.test(n);
