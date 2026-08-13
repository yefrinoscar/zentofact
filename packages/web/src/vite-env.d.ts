/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_ENV?: string;
  readonly VITE_SUNAT_ENV?: string;
  readonly VITE_API_TARGET?: string;
  readonly VITE_API_URL?: string;
  readonly VITE_DEV_LOADING_DELAY_ENABLED?: string;
  readonly VITE_DEV_LOADING_DELAY_MS?: string;
}

declare module '*.png' {
  const src: string;
  export default src;
}

declare module '*.jpg' {
  const src: string;
  export default src;
}

declare module '*.jpeg' {
  const src: string;
  export default src;
}

declare module '*.svg' {
  const src: string;
  export default src;
}

declare module '*.webp' {
  const src: string;
  export default src;
}
