// Expo injects EXPO_PUBLIC_* into process.env at build time (via Babel). Declare
// the shape so TypeScript is happy without pulling in Node types.
declare const process: {
  env: {
    /** Explicit API base URL. Wins over every other source — see src/apiHost.ts. */
    EXPO_PUBLIC_API_URL?: string;
    /** Port used when the API host is derived from the Expo bundler. Defaults to 4000. */
    EXPO_PUBLIC_API_PORT?: string;
    EXPO_PUBLIC_DEV_TOKEN?: string;
    [key: string]: string | undefined;
  };
};

/** React Native's build-time flag: true under `expo start`, false in a release build. */
declare const __DEV__: boolean;
