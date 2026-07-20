// Expo injects EXPO_PUBLIC_* into process.env at build time (via Babel). Declare
// the shape so TypeScript is happy without pulling in Node types.
declare const process: {
  env: {
    EXPO_PUBLIC_API_URL?: string;
    EXPO_PUBLIC_DEV_TOKEN?: string;
    [key: string]: string | undefined;
  };
};
