/** Map v1: 4096 m x 4096 m, centred on the origin. */
export const MAP_SIZE = 4096;
export const MAP_HALF = MAP_SIZE / 2;

/** Streaming / meshing chunk size (m). MAP_SIZE / CHUNK_SIZE chunks per side. */
export const CHUNK_SIZE = 256;
export const CHUNKS_PER_SIDE = MAP_SIZE / CHUNK_SIZE;

/** Default world seed. Every seed gives a different but consistent city. */
export const DEFAULT_SEED = 1;

/** Latitude of Port Solmar (degrees north), used for sun and moon positions. */
export const LATITUDE = 25.8;
