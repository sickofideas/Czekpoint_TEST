/** Decode and re-encode: removes embedded EXIF/GPS and bounds stored photo size. */
export async function preparePhoto(file, maxBytes = 2097152) {
  if (!file) return null;
  if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Vyber fotku ve formátu JPG, PNG nebo WebP.');
  if (!file.size || file.size > 12 * 1024 * 1024) throw new Error('Vstupní fotka musí mít nejvýše 12 MB.');
  let source;
  let sourceUrl;
  try {
    if (typeof createImageBitmap === 'function') source = await createImageBitmap(file);
    else {
      sourceUrl = URL.createObjectURL(file);
      source = new Image();
      source.src = sourceUrl;
      await source.decode();
    }
    const width = source.width || source.naturalWidth;
    const height = source.height || source.naturalHeight;
    if (!width || !height || width * height > 40000000) throw new Error('Fotka je příliš rozměrná. Vyber menší verzi (do 40 megapixelů).');
    const ratio = Math.min(1, 1600 / Math.max(width,height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Tento prohlížeč nedokáže připravit fotku.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source,0,0,canvas.width,canvas.height);
    for (const quality of [.85,.72,.55]) {
      const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/jpeg',quality));
      if (blob && blob.size <= maxBytes) return blob;
    }
    throw new Error('Fotku se nepodařilo zmenšit pod 2 MB. Zkus menší obrázek.');
  } catch(error) {
    if (error?.name === 'InvalidStateError' || error?.name === 'EncodingError') throw new Error('Fotku nelze přečíst. Zkus jiný JPG nebo PNG.');
    throw error;
  } finally {
    source?.close?.();
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  }
}
