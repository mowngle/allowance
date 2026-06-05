// See https://kit.svelte.dev/docs/types#app
declare global {
  namespace App {
    interface Locals {
      session: {
        personId: string;
        role: 'parent' | 'kid';
        familyId: string;
        deviceId: string;
        personName: string;
      } | null;
    }
    // interface Error {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

export {};
