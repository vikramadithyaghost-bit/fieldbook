import type { Geo } from '../../shared/domain';

export const MAX_PHOTOS = 4;

/** Shrinks a camera photo to at most `max` px on the long side as a JPEG data URL (~100–250 KB). */
export async function compressPhoto(file: File, max = 1280, quality = 0.72): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  } catch {
    throw new Error("Couldn't read that photo. Try another one.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The phone's current GPS position. Works without mobile data; needs HTTPS and location permission. */
export function currentPosition(): Promise<Geo> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Location is not available on this phone.'));
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), acc: Math.round(p.coords.accuracy) }),
      e => reject(new Error(e.code === 1 ? 'Location permission is off. Allow location for this site in your browser settings.' : "Couldn't get your location. Try again in the open or near a window.")),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 }
    );
  });
}

export const mapsUrl = (g: Geo) => `https://www.google.com/maps/search/?api=1&query=${g.lat},${g.lng}`;
export const geoLabel = (g: Geo) => `${g.lat.toFixed(5)}, ${g.lng.toFixed(5)}`;
