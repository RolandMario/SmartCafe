// Allow importing static images from the assets folder (e.g. the splash logo)
// the same way Expo's generated app types do.
declare module '*.png' {
  const value: number;
  export default value;
}