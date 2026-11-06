import sharp from 'sharp';

// Deliberately neutral calibration artwork, not a client's photograph or a real player.
// The same fixed sample is used for every template, so layout/crop changes are comparable.
export async function newsPreviewImages() {
  const background = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><rect width="1080" height="1350" fill="#1d3930"/><path fill="#274e3e" d="M0 0h1080v180H0zM0 360h1080v180H0zM0 720h1080v180H0zM0 1080h1080v180H0z"/><g stroke="#9aaca1" stroke-width="5" fill="none"><path d="M100 100h880v1150H100zM100 675h880M310 100v200h460V100M310 1250v-200h460v200"/><circle cx="540" cy="675" r="140"/></g><circle cx="540" cy="675" r="8" fill="#d2d9d3"/></svg>`)).png().toBuffer();
  const secondary = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="700" height="700"><rect width="700" height="700" fill="#76847c"/><circle cx="350" cy="230" r="115" fill="#d4d9d1"/><path d="M95 700v-70c0-240 510-240 510 0v70" fill="#233c32"/><path d="M330 450h40v250h-40z" fill="#f4ff3a"/></svg>`)).png().toBuffer();
  return {background,secondary};
}
