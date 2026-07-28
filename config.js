// ⚠️ Asegúrate de agregar este archivo a .gitignore para evitar subirlo a repositorios públicos.
const firebaseConfig = {
    apiKey: "AIzaSyAkd3NCHTZHx7nzd7nNNAig2NNV-GCPc3c",
    authDomain: "stockdpo.firebaseapp.com",
    // ⚠️ TODO: verificar en Firebase Console → Realtime Database → la URL que figura
    // arriba de los datos. Si la base está en otra región (ej. europe-west1), la URL
    // tiene la forma https://stockdpo-default-rtdb.<region>.firebasedatabase.app
    databaseURL: "https://stockdpo-default-rtdb.firebaseio.com",
    projectId: "stockdpo",
    storageBucket: "stockdpo.firebasestorage.app",
    messagingSenderId: "807489064229",
    appId: "1:807489064229:web:f2c6b5df1d48190ded9ecc"
  };

const GOOGLE_SHEETS_CONFIG = {
    API_KEY: 'AIzaSyDwiZWDc66tv4usDIA-IreiJMLFuk0236Q',
    SPREADSHEET_ID: '1cD50d0-oSTogEe9tYo9ABUSP1ONCy3SAV92zsYYIG84',
    RANGO: 'Lista!A2:Z'
};