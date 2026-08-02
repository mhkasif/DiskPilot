const EXTENSION_MAP = {
  // Videos
  mp4: 'Videos', mkv: 'Videos', mov: 'Videos', avi: 'Videos', wmv: 'Videos', flv: 'Videos', webm: 'Videos', m4v: 'Videos', mpg: 'Videos', mpeg: 'Videos',
  // Audio
  mp3: 'Audio', wav: 'Audio', flac: 'Audio', aac: 'Audio', ogg: 'Audio', m4a: 'Audio', wma: 'Audio', alac: 'Audio',
  // Images
  jpg: 'Images', jpeg: 'Images', png: 'Images', gif: 'Images', svg: 'Images', webp: 'Images', bmp: 'Images', ico: 'Images', tiff: 'Images', psd: 'Images', raw: 'Images', heic: 'Images',
  // Archives
  zip: 'Archives', tar: 'Archives', gz: 'Archives', '7z': 'Archives', rar: 'Archives', bz2: 'Archives', xz: 'Archives', iso: 'Archives', dmg: 'Archives', pkg: 'Archives', deb: 'Archives', rpm: 'Archives',
  // Code
  js: 'Code', ts: 'Code', jsx: 'Code', tsx: 'Code', html: 'Code', css: 'Code', scss: 'Code', json: 'Code', py: 'Code', java: 'Code', c: 'Code', cpp: 'Code', h: 'Code', hpp: 'Code', cs: 'Code', go: 'Code', rs: 'Code', php: 'Code', rb: 'Code', sh: 'Code', bash: 'Code', zsh: 'Code', md: 'Code', yml: 'Code', yaml: 'Code', xml: 'Code', sql: 'Code',
  // Documents
  pdf: 'Documents', doc: 'Documents', docx: 'Documents', xls: 'Documents', xlsx: 'Documents', ppt: 'Documents', pptx: 'Documents', txt: 'Documents', csv: 'Documents', rtf: 'Documents', epub: 'Documents', pages: 'Documents', numbers: 'Documents', key: 'Documents',
  // Executables / Binaries
  exe: 'Executables', dll: 'Executables', bin: 'Executables', dylib: 'Executables', so: 'Executables', app: 'Executables', msi: 'Executables', sys: 'Executables', dat: 'Executables'
};

export function categorize(ext) {
  if (!ext) return 'Other';
  const cleanExt = ext.toLowerCase().trim();
  return EXTENSION_MAP[cleanExt] || 'Other';
}

export const CATEGORIES = [
  'Videos', 'Audio', 'Images', 'Archives', 'Code', 'Documents', 'Executables', 'Other'
];
