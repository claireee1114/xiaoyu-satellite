export const ADMIN_EMAIL = "yingru_94@hotmail.com";

export const STORAGE_FOLDER = "footprint-images";

// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDsBfPtha_0H5jZyugTY8vzyAfcr_VC9lU",
  authDomain: "xiaoyu-satellite.firebaseapp.com",
  projectId: "xiaoyu-satellite",
  storageBucket: "xiaoyu-satellite.firebasestorage.app",
  messagingSenderId: "751515569392",
  appId: "1:751515569392:web:bca563247d8a91f26dc635",
  measurementId: "G-PWV7K0N71M"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);