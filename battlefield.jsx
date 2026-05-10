import React, { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import * as TWEEN from '@tweenjs/tween.js';
import Chart from 'chart.js/auto';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, increment, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';

// ==========================================
// 1. 雲端初始化與全域設定
// ==========================================
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const currentAppId = typeof __app_id !== 'undefined' ? __app_id : 'abula-battlefield';

// 系統預設字典
const DEFAULT_SECTORS = {
    "SEMICON": { name: "半導體 領域", cities: ["2330", "2454", "2303"] },
    "COMPUTER": { name: "電腦週邊 領域", cities: ["2317", "2382", "3231"] },
    "NETWORK": { name: "通信網路 領域", cities: ["2412", "3045", "4904"] }
};

const DEFAULT_CITIES = {
    "2330": { name: "台積電", basePrice: 2290.0 },
    "2454": { name: "聯發科", basePrice: 1150.0 },
    "2303": { name: "聯電",   basePrice: 50.0 },
    "2317": { name: "鴻海",   basePrice: 180.0 },
    "2382": { name: "廣達",   basePrice: 280.0 },
    "3231": { name: "緯創",   basePrice: 115.0 },
    "2412": { name: "中華電", basePrice: 125.0 },
    "3045": { name: "台灣大", basePrice: 100.0 },
    "4904": { name: "遠傳",   basePrice: 105.0 }
};

const TAX_RATE = 0.003;
const FEE_RATE = 0.001425;
const MAX_PHALANX_SIZE = 50;

// 工具：安全數值轉換
const safeNum = (val, fallback = 0) => {
    const n = Number(val);
    return (isNaN(n) || !isFinite(n)) ? fallback : n;
};

// ==========================================
// 3D 渲染與圖表輔助函數
// ==========================================
const getSeason = () => {
    const m = new Date().getMonth() + 1;
    if(m >= 3 && m <= 5) return 'SPRING';
    if(m >= 6 && m <= 8) return 'SUMMER';
    if(m >= 9 && m <= 11) return 'AUTUMN';
    return 'WINTER';
};

const getPriceTier = (price) => {
    if(price < 100) return 1;
    if(price <= 200) return 2;
    if(price <= 500) return 3;
    if(price <= 999) return 4;
    return 5;
};

const createCastle = (tier, season) => {
    const group = new THREE.Group();
    const isWinter = season === 'WINTER';
    const mat = new THREE.MeshPhysicalMaterial({ color: isWinter ? 0x8899aa : 0x556677, roughness: 0.5, metalness: 0.6, clearcoat: 0.3 });
    const height = 18 + tier * 3.5; 
    const wall = new THREE.Mesh(new THREE.BoxGeometry(12, height, 65), mat);
    wall.position.set(-35, height / 2, 0); 
    group.add(wall);
    
    const gate = new THREE.Mesh(new THREE.BoxGeometry(13, 8, 10), new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.8, roughness: 0.2 }));
    gate.position.set(-34, 4, 0); 
    group.add(gate);

    for(let z = -25; z <= 25; z+=10) {
        const battlement = new THREE.Mesh(new THREE.BoxGeometry(12, 4, 5), mat);
        battlement.position.set(-35, height + 2, z); 
        group.add(battlement);
    }
    
    if (tier >= 4) {
        const glowColor = tier === 5 ? 0x00ffff : 0xffaa00; 
        const glowMat = new THREE.MeshStandardMaterial({color: glowColor, emissive: glowColor, emissiveIntensity: tier === 5 ? 3 : 1.5});
        const line = new THREE.Mesh(new THREE.BoxGeometry(13, 1, 66), glowMat);
        line.position.set(-35, height * 0.8, 0);
        group.add(line);
        
        const turretMat = new THREE.MeshPhysicalMaterial({ color: 0x2a303c, metalness: 0.8, roughness: 0.2, clearcoat: 0.5 });
        for(let z of [-20, 0, 20]) {
            const turretGroup = new THREE.Group();
            turretGroup.position.set(-32, height + 2, z);
            const turretBase = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.5, 3, 16), mat);
            turretBase.position.y = 1.5;
            turretGroup.add(turretBase);
            const turretDome = new THREE.Mesh(new THREE.SphereGeometry(2.5, 16, 16), turretMat);
            turretDome.position.y = 3;
            turretGroup.add(turretDome);
            const cannon = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.4, 10, 16), glowMat); 
            cannon.rotation.x = Math.PI / 2; cannon.position.set(0, 3, 5); 
            turretGroup.add(cannon); 
            turretGroup.rotation.y = Math.PI / 2;
            group.add(turretGroup);
        }

        if (tier === 5) {
            const shield = new THREE.Mesh(new THREE.BoxGeometry(20, height + 15, 80), new THREE.MeshBasicMaterial({color: 0x00ffff, transparent: true, opacity: 0.1, wireframe: true}));
            shield.position.set(-35, (height + 15) / 2, 0);
            group.add(shield);
        }
    }
    return group;
};

const createForest = (season) => {
    const group = new THREE.Group();
    let leafColor = season === 'SUMMER' ? 0x15803d : season === 'AUTUMN' ? 0xf97316 : season === 'WINTER' ? 0x94a3b8 : 0x22c55e;
    const mat = new THREE.MeshStandardMaterial({color: leafColor, flatShading: true, roughness: 0.9});
    for(let i=0; i<45; i++) {
        const tree = new THREE.Group();
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.2, 4), new THREE.MeshStandardMaterial({color: 0x4a2e15})); 
        trunk.position.y = 2;
        const leaves1 = new THREE.Mesh(new THREE.ConeGeometry(4.5, 8, 7), mat); leaves1.position.y = 6;
        const leaves2 = new THREE.Mesh(new THREE.ConeGeometry(3.5, 6, 7), mat); leaves2.position.y = 11;
        tree.add(trunk, leaves1, leaves2);
        tree.scale.setScalar(1.0 + Math.random() * 0.8); 
        tree.position.set(30 + Math.random()*25, 0, (Math.random()-0.5)*80);
        group.add(tree);
    }
    return group;
};

const createSoldier = (colorHex, isPlayer, tier, side) => {
    const group = new THREE.Group();
    if (tier >= 4) {
        let sc = isPlayer ? 1.8 : 1.2;
        const tankMat = new THREE.MeshPhysicalMaterial({ color: colorHex, metalness: 0.7, roughness: 0.3, clearcoat: 0.5 });
        const base = new THREE.Mesh(new THREE.BoxGeometry(4.0*sc, 1.2*sc, 2.8*sc), tankMat); 
        base.position.y = 0.6*sc; group.add(base);
        const top = new THREE.Mesh(new THREE.SphereGeometry(1.4*sc, 16, 16), new THREE.MeshStandardMaterial({color: 0x222222, metalness: 0.9, roughness: 0.1})); 
        top.position.y = 1.4*sc; group.add(top);
        const cannonColor = side === 'LONG' ? 0xff4444 : 0x44ff44;
        const cannon = new THREE.Mesh(new THREE.CylinderGeometry(0.15*sc, 0.1*sc, 4.0*sc), new THREE.MeshStandardMaterial({color: cannonColor, emissive: cannonColor, emissiveIntensity: 3}));
        cannon.rotation.x = Math.PI / 2; cannon.position.set(0, 1.4*sc, 2.0*sc); 
        group.add(cannon);
        group.rotation.y = side === 'LONG' ? Math.PI / 2 : -Math.PI / 2;
        group.userData.cannonPos = new THREE.Vector3(0, 1.4*sc, 3.5*sc);
    } else {
        let sc = (isPlayer ? 2.4 : 1.5) * (1 + (tier - 1) * 0.12);
        const mat = new THREE.MeshStandardMaterial({ color: colorHex, emissive: isPlayer ? colorHex : 0x000000, emissiveIntensity: 0.6, roughness: 0.2 });
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.4*sc, 0.6*sc, 2.2*sc, 6), mat); 
        body.position.y = sc; group.add(body);
        const head = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5*sc), mat); 
        head.position.y = 2.7 * sc; group.add(head);
        group.rotation.y = side === 'LONG' ? Math.PI / 2 : -Math.PI / 2;
        const wColor = colorHex === 0xdd3333 ? 0xff4444 : 0x44ff44;
        const wpn = new THREE.Mesh(new THREE.CylinderGeometry(0.06*sc, 0.06*sc, 5.5*sc, 4), new THREE.MeshStandardMaterial({color: wColor, emissive: wColor, emissiveIntensity: 2}));
        wpn.position.set(0, 1.5 * sc, 1.5 * sc); wpn.rotation.x = Math.PI / 2; 
        group.add(wpn);
        group.userData.cannonPos = new THREE.Vector3(0, 1.5*sc, 4.0*sc);
    }
    group.userData = Object.assign(group.userData, { isAttacking: false, baseX: 0, active: true, side: side });
    return group;
};

const calcProfit = (side, entryPrice, currentMarketPrice, qty) => {
    const diff = side === 'LONG' ? (currentMarketPrice - entryPrice) : (entryPrice - currentMarketPrice);
    const grossProfit = diff * qty * 1000;
    const fees = (currentMarketPrice * qty * 1000) * (FEE_RATE + TAX_RATE);
    return grossProfit - fees;
};

const calcEMA = (data, period) => { if(data.length === 0) return []; let k = 2 / (period + 1); let ema = [data[0]]; for(let i = 1; i < data.length; i++) { ema.push(data[i] * k + ema[i - 1] * (1 - k)); } return ema; };
const calcSMA = (data, period) => { let sma = []; for(let i = 0; i < data.length; i++) { if(i < period - 1) { sma.push(data[i]); continue; } let sum = 0; for(let j = 0; j < period; j++) { sum += data[i - j]; } sma.push(sum / period); } return sma; };
const calcMACD = (data) => { if(data.length < 26) return {macd: [], signal: [], hist: []}; let ema12 = calcEMA(data, 12); let ema26 = calcEMA(data, 26); let macd = ema12.map((v, i) => v - ema26[i]); let signal = calcEMA(macd, 9); let hist = macd.map((v, i) => v - signal[i]); return {macd, signal, hist}; };
const calcKD = (data, period = 9) => { if(data.length < period) return {k: [], d: []}; let k = [], dv = [], pk = 50, pd = 50; for(let i = 0; i < data.length; i++) { let st = Math.max(0, i - period + 1); let sl = data.slice(st, i + 1); let hi = Math.max(...sl); let lo = Math.min(...sl); let rsv = (hi === lo) ? 50 : ((data[i] - lo) / (hi - lo)) * 100; let ck = (2 / 3) * pk + (1 / 3) * rsv; let cd = (2 / 3) * pd + (1 / 3) * ck; k.push(ck); dv.push(cd); pk = ck; pd = cd; } return {k, dv}; };
const calcRSI = (data, period) => { if(data.length < period) return new Array(data.length).fill(50); let rsi = [], g = 0, l = 0; for(let i = 1; i <= period; i++) { let df = data[i] - data[i - 1]; if(df >= 0) g += df; else l -= df; } let ag = g / period; let al = l / period; rsi.push(100 - (100 / (1 + (al === 0 ? 999 : ag / al)))); for(let i = period + 1; i < data.length; i++) { let df = data[i] - data[i - 1]; ag = (ag * (period - 1) + (df >= 0 ? df : 0)) / period; al = (al * (period - 1) + (df < 0 ? -df : 0)) / period; rsi.push(100 - (100 / (1 + (al === 0 ? 999 : ag / al)))); } return new Array(period).fill(50).concat(rsi); };
const calcBIAS = (data, period) => { if(data.length < period) return new Array(data.length).fill(0); let s = calcSMA(data, period); return data.map((v, i) => s[i] > 0 ? ((v - s[i]) / s[i]) * 100 : 0); };

// ==========================================
// 主應用程式元件
// ==========================================
export default function App() {
    const [user, setUser] = useState(null);
    const [isLoggingIn, setIsLoggingIn] = useState(true);
    const [activeTab, setActiveTab] = useState('units');
    const [toastMsg, setToastMsg] = useState({ text: '', visible: false });
    const [modalState, setModalState] = useState(null); 
    const [thunderType, setThunderType] = useState(null);
    const [goldRain, setGoldRain] = useState(false);

    // 表單與輸入狀態
    const [orderQty, setOrderQty] = useState(1);
    const [orderPrice, setOrderPrice] = useState('');
    const [customSymbol, setCustomSymbol] = useState('');
    const [customName, setCustomName] = useState('');
    
    // 報表結算狀態 (嚴格遵守 React 狀態渲染)
    const [reportPnl, setReportPnl] = useState(0);
    const [simRewardData, setSimRewardData] = useState({ profit: 0, reward: 0 });
    const [globalStats, setGlobalStats] = useState({ totalUsers: 0, todayActive: 0 });

    const [isSimMode, setIsSimMode] = useState(false);
    const [marketState, setMarketState] = useState("CLOSED");
    const [currentPrice, setCurrentPrice] = useState(0);
    const [chartDataCache, setChartDataCache] = useState({});

    const [gameState, setGameState] = useState({
        balance: 5000000, frozen: 0, realizedPnl: 0, activeSector: "SEMICON", activeCity: "2330",
        timeframe: "1d", activeIndicator: "MACD", units: [], history: [], pending: [], apiKey: ""
    });

    const [sectors, setSectors] = useState(DEFAULT_SECTORS);
    const [citiesData, setCitiesData] = useState(DEFAULT_CITIES);
    
    // Refs
    const threeContainerRef = useRef(null);
    const mainChartRef = useRef(null);
    const volChartRef = useRef(null);
    const indChartRef = useRef(null);
    const chartInsts = useRef({ main: null, vol: null, ind: null });
    const pollInterval = useRef(null); // 【核心修復】補齊漏掉的時鐘輪詢器指標
    
    const engine = useRef({
        scene: null, camera: null, renderer: null, battleLine: null,
        castleGroup: null, forestGroup: null,
        baseRed: [], baseGreen: [], playerRed: [], playerGreen: [],
        particles: { snow: null, smoke: null, fire: null },
        effects: { fireworks: [], lasers: [], explosions: [] },
        reqId: null
    });

    const engineActions = useRef({});
    const realStateSnapshot = useRef(null);
    
    // 狀態集中管理以供 setInterval 取得最新資料
    const stateRef = useRef();
    stateRef.current = { user, isSimMode, marketState, currentPrice, gameState, sectors, citiesData, chartDataCache, modalState };

    // ==========================================
    // 初始認證
    // ==========================================
    useEffect(() => {
        const initAuth = async () => {
            try {
                if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                    await signInWithCustomToken(auth, __initial_auth_token);
                } else {
                    await signInAnonymously(auth);
                }
            } catch (error) { setIsLoggingIn(false); }
        };
        initAuth();

        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser);
            setIsLoggingIn(false);
            if (currentUser) updateGlobalStats(currentUser.uid);
        });
        return () => unsubscribe();
    }, []);

    // 監聽全域統計與個人資料
    useEffect(() => {
        if (!user) return;
        const statsRef = doc(db, 'artifacts', currentAppId, 'public', 'data', 'stats', 'global');
        const unsub = onSnapshot(statsRef, (docSnap) => {
            if (docSnap.exists()) {
                const d = docSnap.data();
                setGlobalStats({ totalUsers: typeof d.totalUsers === 'number' ? d.totalUsers : 0, todayActive: typeof d.todayActive === 'number' ? d.todayActive : 0 });
            }
        });
        return () => unsub();
    }, [user]);

    useEffect(() => {
        if (!user) return;
        const userRef = doc(db, 'artifacts', currentAppId, 'users', user.uid, 'gameData', 'save');
        const unsub = onSnapshot(userRef, (docSnap) => {
            if (docSnap.exists() && !stateRef.current.isSimMode) {
                const data = docSnap.data();
                if(data.state) setGameState(prev => ({ ...prev, ...data.state }));
                if(data.sectors) setSectors(data.sectors);
                if(data.cities) setCitiesData(data.cities);
            } else if (!docSnap.exists() && !stateRef.current.isSimMode) {
                saveDataToCloud(gameState, DEFAULT_SECTORS, DEFAULT_CITIES);
            }
        });
        return () => unsub();
    }, [user]);

    const updateGlobalStats = async (uid) => {
        try {
            const today = new Date().toISOString().split('T')[0];
            const statsRef = doc(db, 'artifacts', currentAppId, 'public', 'data', 'stats', 'global');
            const userTrackRef = doc(db, 'artifacts', currentAppId, 'public', 'data', 'tracking', uid);
            const trackSnap = await getDoc(userTrackRef);
            if (!trackSnap.exists()) {
                await setDoc(userTrackRef, { lastLogin: today });
                await setDoc(statsRef, { totalUsers: increment(1), todayActive: increment(1) }, { merge: true });
            } else if (trackSnap.data().lastLogin !== today) {
                await updateDoc(userTrackRef, { lastLogin: today });
                await setDoc(statsRef, { todayActive: increment(1) }, { merge: true });
            }
        } catch (e) { }
    };

    const saveDataToCloud = async (newState, newSectors, newCities) => {
        if (!user || stateRef.current.isSimMode) return;
        try {
            const userRef = doc(db, 'artifacts', currentAppId, 'users', user.uid, 'gameData', 'save');
            await setDoc(userRef, { state: newState || stateRef.current.gameState, sectors: newSectors || stateRef.current.sectors, cities: newCities || stateRef.current.citiesData, updatedAt: serverTimestamp() });
        } catch (e) {}
    };

    const showMessage = (text) => {
        setToastMsg({ text, visible: true });
        setTimeout(() => setToastMsg({ text: '', visible: false }), 3000);
    };

    const triggerThunder = (type) => { setThunderType(type); setTimeout(() => setThunderType(null), 800); };
    const triggerGoldRain = () => { setGoldRain(true); setTimeout(() => setGoldRain(false), 4000); };

    // ==========================================
    // 3D 渲染引擎 (Three.js) 初始化
    // ==========================================
    useEffect(() => {
        if (!user || !threeContainerRef.current) return;
        
        const scene = new THREE.Scene();
        scene.fog = new THREE.FogExp2(0x02050a, 0.008);
        const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1000);
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        threeContainerRef.current.appendChild(renderer.domElement);

        scene.add(new THREE.AmbientLight(0xffffff, 4.0));
        const dLight = new THREE.DirectionalLight(0xffffff, 5.0);
        dLight.position.set(20, 100, 40); 
        scene.add(dLight);
        
        const grid = new THREE.GridHelper(200, 80, 0x1e293b, 0x0f172a);
        grid.position.y = 0.01;
        scene.add(grid);
        
        const battleLine = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.2, 70), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }));
        scene.add(battleLine);

        camera.position.set(0, 35, 65); 
        camera.lookAt(0, 5, 0);

        engine.current = { ...engine.current, scene, camera, renderer, battleLine };

        // 綁定引擎操作
        engineActions.current.rebuildEnvironment = () => {
            const { scene, castleGroup, forestGroup, particles } = engine.current;
            const { gameState, citiesData } = stateRef.current;
            const city = citiesData[gameState.activeCity] || { basePrice: 100 };
            const tier = getPriceTier(safeNum(city.basePrice));
            const season = getSeason();

            if(castleGroup) scene.remove(castleGroup);
            if(forestGroup) scene.remove(forestGroup);
            if(particles.snow) { scene.remove(particles.snow); engine.current.particles.snow = null; }
            engineActions.current.clearSmokeAndFire();
            
            const newCastle = createCastle(tier, season);
            const newForest = createForest(season);
            scene.add(newCastle); scene.add(newForest);
            engine.current.castleGroup = newCastle; engine.current.forestGroup = newForest;

            if (season === 'WINTER') {
                const geom = new THREE.BufferGeometry(); const pos = new Float32Array(300 * 3);
                for(let i=0; i<300; i++) { pos[i*3]=(Math.random()-0.5)*150; pos[i*3+1]=Math.random()*60; pos[i*3+2]=(Math.random()-0.5)*120; }
                geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
                const snow = new THREE.Points(geom, new THREE.PointsMaterial({color: 0xffffff, size: 0.6, transparent: true, opacity: 0.6}));
                scene.add(snow); engine.current.particles.snow = snow;
            }

            engine.current.baseRed.forEach(m => scene.remove(m)); engine.current.baseRed = [];
            engine.current.baseGreen.forEach(m => scene.remove(m)); engine.current.baseGreen = [];
            
            const cols = Math.floor(MAX_PHALANX_SIZE / 5);
            for(let i=0; i<MAX_PHALANX_SIZE; i++) {
                const r = Math.floor(i / cols); const c = i % cols; const zPos = (c - cols/2 + 0.5) * 4.5;
                const rm = createSoldier(0xaa2222, false, tier, 'LONG'); rm.position.set(-12 - r*3, 0, zPos); rm.userData.baseX = -12 - r*3;
                engine.current.baseRed.push(rm); scene.add(rm);
                
                const gm = createSoldier(0x228822, false, tier, 'SHORT'); gm.position.set(12 + r*3, 0, zPos); gm.userData.baseX = 12 + r*3;
                engine.current.baseGreen.push(gm); scene.add(gm);
            }
            engineActions.current.syncPlayerTroops();
        };

        engineActions.current.syncPlayerTroops = () => {
            const { scene, playerRed, playerGreen } = engine.current;
            const { gameState, citiesData } = stateRef.current;
            const tier = getPriceTier(safeNum(citiesData[gameState.activeCity]?.basePrice, 100));
            [...playerRed, ...playerGreen].forEach(m => scene.remove(m));
            engine.current.playerRed = []; engine.current.playerGreen = [];
            
            gameState.units.filter(u => u.city === gameState.activeCity).forEach(u => {
                const m = createSoldier(u.side==='LONG'?0xff2222:0x22ff22, true, tier, u.side);
                m.position.set(u.side==='LONG' ? -7 : 7, 0, (Math.random()-0.5)*25); m.userData.baseX = m.position.x;
                scene.add(m);
                if(u.side==='LONG') engine.current.playerRed.push(m); else engine.current.playerGreen.push(m);
            });
        };

        engineActions.current.fireLaser = (attacker) => {
            const s = attacker.userData.side; const c = s === 'LONG' ? 0xff3333 : 0x33ff33;
            const laser = new THREE.Mesh(new THREE.CylinderGeometry(0.2,0.2,8,4), new THREE.MeshBasicMaterial({color: c, transparent: true, opacity: 0.9}));
            const pos = attacker.position.clone(); pos.y += 3; const dir = s === 'LONG' ? 1 : -1; pos.x += dir*2;
            laser.position.copy(pos); laser.rotation.z = Math.PI/2;
            engine.current.scene.add(laser); engine.current.effects.lasers.push({mesh: laser, life: 1, dir, speed: 3.5});
        };

        engineActions.current.shootLaserFromCastle = () => {
            const laserMat = new THREE.MeshBasicMaterial({color: 0xffaa00, transparent: true, opacity: 0.9}); 
            const laser = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 15, 4), laserMat);
            laser.position.copy(new THREE.Vector3(-30, 20 + Math.random()*10, (Math.random() - 0.5) * 40));
            laser.rotation.z = Math.PI / 2; 
            engine.current.scene.add(laser); engine.current.effects.lasers.push({ mesh: laser, life: 1.0, dir: 1, speed: 4.5 });
        };

        engineActions.current.spawnExplosion = (x, y, z, color) => {
            const geom = new THREE.BufferGeometry(); const pos = new Float32Array(30 * 3); const vels = [];
            for(let j=0; j<30; j++) { pos[j*3]=x; pos[j*3+1]=y; pos[j*3+2]=z; vels.push({x:(Math.random()-0.5)*1.5, y:(Math.random()-0.5)*1.5, z:(Math.random()-0.5)*1.5}); }
            geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            const exp = new THREE.Points(geom, new THREE.PointsMaterial({color, size: 0.8, transparent: true, blending: THREE.AdditiveBlending}));
            exp.userData = { vels, life: 1 }; engine.current.scene.add(exp); engine.current.effects.explosions.push(exp);
        };

        engineActions.current.triggerFireworks = () => {
            for(let i=0; i<6; i++) {
                setTimeout(() => {
                    const geom = new THREE.BufferGeometry(); const pos = new Float32Array(150*3); const vels = [];
                    const cx = (Math.random()-0.5)*80; const cy = 40+Math.random()*20; const cz = (Math.random()-0.5)*40;
                    for(let j=0; j<150; j++) { pos[j*3]=cx; pos[j*3+1]=cy; pos[j*3+2]=cz; vels.push({x:(Math.random()-0.5)*2.5,y:(Math.random()-0.5)*2.5,z:(Math.random()-0.5)*2.5}); }
                    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
                    const fw = new THREE.Points(geom, new THREE.PointsMaterial({color: Math.random()>0.5?0xff3333:0xffaa00, size:1.2, transparent:true, blending:THREE.AdditiveBlending}));
                    fw.userData = { vels, life: 1 }; engine.current.scene.add(fw); engine.current.effects.fireworks.push(fw);
                }, i * 300);
            }
        };

        engineActions.current.triggerCastleSmoke = () => {
            if(engine.current.particles.smoke) return;
            const geom = new THREE.BufferGeometry(); const pos = new Float32Array(200*3); const vels = [];
            for(let i=0; i<200; i++) { pos[i*3]=-35+(Math.random()-0.5)*15; pos[i*3+1]=10+Math.random()*20; pos[i*3+2]=(Math.random()-0.5)*50; vels.push({x:Math.random()*0.2,y:0.1+Math.random()*0.3,z:(Math.random()-0.5)*0.2}); }
            geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            const smk = new THREE.Points(geom, new THREE.PointsMaterial({color: 0x333333, size: 4.0, transparent: true, opacity: 0.8}));
            smk.userData = { vels }; engine.current.scene.add(smk); engine.current.particles.smoke = smk;
            
            const fGeom = new THREE.BufferGeometry(); const fPos = new Float32Array(100*3);
            for(let i=0;i<100;i++){ fPos[i*3]=-35+(Math.random()-0.5)*20; fPos[i*3+1]=Math.random()*15; fPos[i*3+2]=(Math.random()-0.5)*60; }
            fGeom.setAttribute('position', new THREE.BufferAttribute(fPos, 3));
            const fire = new THREE.Points(fGeom, new THREE.PointsMaterial({color: 0xff3300, size: 5.0, transparent: true, blending: THREE.AdditiveBlending}));
            engine.current.scene.add(fire); engine.current.particles.fire = fire;
        };

        engineActions.current.clearSmokeAndFire = () => {
            if(engine.current.particles.smoke) { engine.current.scene.remove(engine.current.particles.smoke); engine.current.particles.smoke = null; }
            if(engine.current.particles.fire) { engine.current.scene.remove(engine.current.particles.fire); engine.current.particles.fire = null; }
        };

        engineActions.current.triggerAttackAnim = (side, magnitude = 1) => {
            const { baseRed, baseGreen, playerRed, playerGreen, battleLine } = engine.current;
            const baseArmy = side === 'LONG' ? baseRed : baseGreen;
            const available = baseArmy.filter(m => m.userData.active && !m.userData.isAttacking);
            available.sort((a,b) => side==='LONG' ? b.position.x - a.position.x : a.position.x - b.position.x);
            
            const count = Math.max(3, Math.min(20, Math.floor(magnitude * 15)));
            const attackers = available.slice(0, count);
            const dir = side === 'LONG' ? 1 : -1;
            
            attackers.forEach((m, idx) => {
                m.userData.isAttacking = true;
                setTimeout(() => engineActions.current.fireLaser(m), idx*50);
                new TWEEN.Tween(m.position).to({x: battleLine.position.x - (dir*1.5), y: 3}, 150).easing(TWEEN.Easing.Quadratic.Out)
                    .onComplete(() => new TWEEN.Tween(m.position).to({x: m.userData.baseX, y: 0}, 400).easing(TWEEN.Easing.Quadratic.In).onComplete(()=>m.userData.isAttacking=false).start()).start();
            });
        };

        engineActions.current.rebuildEnvironment();

        const handleResize = () => {
            if(!engine.current.camera || !engine.current.renderer) return;
            engine.current.camera.aspect = window.innerWidth / window.innerHeight;
            engine.current.camera.updateProjectionMatrix();
            engine.current.renderer.setSize(window.innerWidth, window.innerHeight);
        };
        window.addEventListener('resize', handleResize);
        
        const animate = () => {
            engine.current.reqId = requestAnimationFrame(animate);
            TWEEN.update();
            const { scene, camera, renderer, particles, effects, baseRed, baseGreen, playerRed, playerGreen, battleLine } = engine.current;
            if(!scene) return;

            if(particles.snow) {
                const p = particles.snow.geometry.attributes.position.array;
                for(let i=0; i<300; i++) { p[i*3+1] -= 0.15; if(p[i*3+1]<0) p[i*3+1]=60; }
                particles.snow.geometry.attributes.position.needsUpdate = true;
            }
            if(particles.smoke) {
                const p = particles.smoke.geometry.attributes.position.array; const v = particles.smoke.userData.vels;
                for(let i=0; i<200; i++) { p[i*3]+=v[i].x; p[i*3+1]+=v[i].y; p[i*3+2]+=v[i].z; if(p[i*3+1]>40) { p[i*3]=-35+(Math.random()-0.5)*15; p[i*3+1]=10; p[i*3+2]=(Math.random()-0.5)*50; } }
                particles.smoke.geometry.attributes.position.needsUpdate = true;
            }

            for(let i = effects.lasers.length - 1; i >= 0; i--) {
                let l = effects.lasers[i]; l.mesh.position.x += l.dir * l.speed; l.life -= 0.05; l.mesh.material.opacity = l.life;
                if (Math.abs(l.mesh.position.x) < 2.0 && l.life > 0.5) {
                    engineActions.current.spawnExplosion(l.mesh.position.x, l.mesh.position.y, l.mesh.position.z, l.mesh.material.color.getHex()); l.life = 0;
                }
                if(l.life <= 0) { scene.remove(l.mesh); effects.lasers.splice(i,1); }
            }

            const processPoints = (arr) => {
                for(let i=arr.length-1; i>=0; i--) {
                    const a = arr[i]; a.userData.life -= 0.015; a.material.opacity = a.userData.life;
                    const p = a.geometry.attributes.position.array; const v = a.userData.vels;
                    for(let j=0; j<v.length; j++) { p[j*3]+=v[j].x; p[j*3+1]+=v[j].y; p[j*3+2]+=v[j].z; }
                    a.geometry.attributes.position.needsUpdate = true;
                    if(a.userData.life <= 0) { scene.remove(a); arr.splice(i,1); }
                }
            };
            processPoints(effects.fireworks);
            processPoints(effects.explosions);

            const { isSimMode, currentPrice, activeCity, citiesData } = stateRef.current.gameState ? stateRef.current : { isSimMode: false, currentPrice: 0, citiesData: {} };
            const city = citiesData[activeCity || "2330"];
            const bp = isSimMode ? safeNum(city?.simBasePrice) : safeNum(city?.basePrice, 100);
            const diff = bp > 0 ? (currentPrice - bp) / bp : 0;
            const drift = safeNum(diff * 600, 0);
            
            if (battleLine) battleLine.position.x += (drift - battleLine.position.x) * 0.15;
            const shift = drift * 0.4;
            
            [...baseRed, ...playerRed].forEach(m => { if(!m.userData.isAttacking) m.position.x += ((m.userData.baseX + shift) - m.position.x) * 0.1; });
            [...baseGreen, ...playerGreen].forEach(m => { if(!m.userData.isAttacking) m.position.x += ((m.userData.baseX + shift) - m.position.x) * 0.1; });

            renderer.render(scene, camera);
        };
        animate();

        return () => {
            window.removeEventListener('resize', handleResize);
            if (engine.current.reqId) cancelAnimationFrame(engine.current.reqId);
            renderer.dispose();
            if(threeContainerRef.current) threeContainerRef.current.innerHTML = '';
        };
    }, [user]);

    useEffect(() => {
        if (!user || !engine.current.scene) return;
        engineActions.current.rebuildEnvironment();
        fetchChartData();
    }, [gameState.activeCity, user]);

    // ==========================================
    // 資料輪詢與沙盤推演心跳
    // ==========================================
    const fetchMarketData = async (forceLocal = false) => {
        if(stateRef.current.isSimMode) return;
        const cityCode = stateRef.current.gameState.activeCity; 
        const city = stateRef.current.citiesData[cityCode]; 
        if(!city) return;

        let fetchedPrice = null, fetchedBase = null;
        const ySym = /^\d{4}$/.test(cityCode) ? cityCode + '.TW' : cityCode;
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ySym}?interval=1m&range=1d`;
        
        const fetchAPI = async (proxyUrl) => {
            try {
                const res = await Promise.race([ fetch(proxyUrl), new Promise((_, r) => setTimeout(()=>r(new Error('timeout')), 3000)) ]);
                if(res.ok) {
                    const data = await res.json();
                    if(data?.chart?.result?.[0]) {
                        fetchedPrice = data.chart.result[0].meta.regularMarketPrice;
                        fetchedBase = data.chart.result[0].meta.previousClose;
                        return true;
                    }
                }
            } catch(e) {}
            return false;
        };

        if(!forceLocal) {
            let success = false;
            if (stateRef.current.gameState.apiKey) success = await fetchAPI(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}&key=${stateRef.current.gameState.apiKey}`);
            if (!success) success = await fetchAPI(`https://corsproxy.io/?url=${encodeURIComponent(url)}`);
            if (!success) success = await fetchAPI(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`);
        }

        const p = parseFloat(fetchedPrice);
        if (!isNaN(p) && p > 0) {
            setCitiesData(prev => ({...prev, [cityCode]: {...prev[cityCode], realPrice: p, basePrice: parseFloat(fetchedBase)||p, price: p}}));
            setCurrentPrice(p);
        } else {
            if (city.basePrice > 0) {
                setCitiesData(prev => ({...prev, [cityCode]: {...prev[cityCode], realPrice: city.basePrice, price: city.basePrice}}));
                setCurrentPrice(city.basePrice);
            }
        }
    };

    useEffect(() => {
        if (!user) return;
        
        pollInterval.current = setInterval(() => {
            const { isSimMode, marketState, currentPrice, gameState, citiesData } = stateRef.current;
            const now = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Taipei"}));
            const day = now.getDay(); const t = now.getHours() * 100 + now.getMinutes();
            let nStatus = "CLOSED";
            if (day >= 1 && day <= 5) { if(t>=855 && t<900) nStatus = "PRE"; else if (t>=900 && t<1330) nStatus = "OPEN"; }

            if(nStatus !== marketState) {
                if(nStatus === "OPEN" && isSimMode) handleCloseSimMode();
                setMarketState(nStatus);
            }

            if(!isSimMode && nStatus === "OPEN") {
                if(engine.current.baseRed.length > 0 && Math.random() > 0.85) engineActions.current.fireLaser(engine.current.baseRed[Math.floor(Math.random()*engine.current.baseRed.length)]);
                if(engine.current.baseGreen.length > 0 && Math.random() > 0.85) engineActions.current.fireLaser(engine.current.baseGreen[Math.floor(Math.random()*engine.current.baseGreen.length)]);
                const city = citiesData[gameState.activeCity];
                if (city && getPriceTier(safeNum(city.basePrice)) >= 4 && Math.random() > 0.9) engineActions.current.shootLaserFromCastle();
            }

            if(isSimMode) {
                const city = citiesData[gameState.activeCity];
                if(city) {
                    if(engine.current.baseRed.length > 0 && Math.random() > 0.6) engineActions.current.fireLaser(engine.current.baseRed[Math.floor(Math.random()*engine.current.baseRed.length)]);
                    if(engine.current.baseGreen.length > 0 && Math.random() > 0.6) engineActions.current.fireLaser(engine.current.baseGreen[Math.floor(Math.random()*engine.current.baseGreen.length)]);
                    if (getPriceTier(safeNum(city.simBasePrice)) >= 4 && Math.random() > 0.7) engineActions.current.shootLaserFromCastle();

                    const bp = safeNum(city.simBasePrice, city.basePrice); const md = bp*0.05;
                    let np = safeNum(currentPrice, bp) + (Math.random()-0.5)*safeNum(city.vol, 2.0)*2;
                    if(np > bp+md) np = bp+md; if(np < bp-md) np = bp-md;
                    
                    setCurrentPrice(np);
                    setCitiesData(prev => ({...prev, [gameState.activeCity]: {...prev[gameState.activeCity], price: np}}));
                    
                    if(Math.abs(np - engine.current.lastPrice) > 0.01) {
                        engineActions.current.triggerAttackAnim(np > engine.current.lastPrice ? 'LONG' : 'SHORT', Math.abs(np - engine.current.lastPrice));
                        engine.current.lastPrice = np;
                    }
                    
                    const dp = (np - bp)/bp;
                    if(dp >= 0.098) engineActions.current.triggerFireworks();
                    else if(dp <= -0.098) engineActions.current.triggerCastleSmoke();
                    else engineActions.current.clearSmokeAndFire();

                    if(city.chartData && city.chartData[gameState.timeframe]) {
                        let chartArr = city.chartData[gameState.timeframe];
                        if(chartArr.length > 0) {
                            let lastBar = chartArr[chartArr.length - 1]; let timeNow = Date.now();
                            if (timeNow - lastBar.x > 30000) {
                                chartArr.push({ x: timeNow, o: np, h: np, l: np, c: np, v: Math.random() * 50 });
                                if (chartArr.length > 150) chartArr.shift(); 
                            } else {
                                lastBar.c = np; lastBar.h = Math.max(lastBar.h, np); lastBar.l = Math.min(lastBar.l, np); lastBar.v += Math.random() * 10;
                            }
                        }
                    }
                }
            } else if (nStatus === "OPEN" && Math.random() > 0.8) {
                fetchMarketData();
            }
        }, 1000);

        return () => clearInterval(pollInterval.current);
    }, [user]);

    const initKbars = (cityObj, startPrice) => {
        let tempC = startPrice;
        const volBase = tempC * 0.005; let time = Date.now() - 100 * 60000; 
        const tfs = ["1m", "5m", "15m", "30m", "60m", "1d", "1wk", "1mo"];
        tfs.forEach(tf => { 
            let fakeData = []; let curC = tempC; let trend = 0;
            for(let i = 0; i < 100; i++) {
                let o = curC; 
                trend += (Math.random() - 0.5) * 0.002;
                if (trend > 0.01) trend = 0.01; if (trend < -0.01) trend = -0.01;
                curC += (curC * trend) + (Math.random() - 0.5) * volBase;
                if(curC <= 0.1) curC = 0.1;
                let h = Math.max(o, curC) + Math.abs(curC * (Math.random() * 0.002));
                let l = Math.min(o, curC) - Math.abs(curC * (Math.random() * 0.002));
                fakeData.push({ x: time + i * 60000, o: o, h: h, l: l, c: curC, v: 100 + Math.random() * 900 });
            }
            if (!cityObj.chartData) cityObj.chartData = {};
            cityObj.chartData[tf] = fakeData; 
        });
    };

    // ==========================================
    // 圖表渲染
    // ==========================================
    const fetchChartData = async () => {
        const { isSimMode, gameState, citiesData } = stateRef.current;
        if(isSimMode) return; 
        const cityCode = gameState.activeCity; const city = citiesData[cityCode]; if(!city) return;
        
        const map = { "1m":{i:"1m",r:"1d"}, "1d":{i:"1d",r:"6mo"} }; 
        const prm = map[gameState.timeframe] || map["1d"];
        const ySym = /^\d{4}$/.test(cityCode) ? cityCode + '.TW' : cityCode;
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ySym}?interval=${prm.i}&range=${prm.r}`;
        
        let ohlc = [];
        try {
            const res = await fetch(`https://corsproxy.io/?url=${encodeURIComponent(url)}`);
            if(res.ok) {
                const data = await res.json();
                if(data?.chart?.result?.[0]) {
                    const r = data.chart.result[0]; const q = r.indicators.quote[0]; const ts = r.timestamp || [];
                    for(let i=0; i<ts.length; i++) { if(q.close[i] !== null) ohlc.push({x: ts[i]*1000, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i]}); }
                }
            }
        } catch(e) {}
        
        if(ohlc.length < 10) {
            let tc = safeNum(city.basePrice, 100); let t = Date.now() - 100*60000;
            for(let i=0;i<100;i++){ let o=tc; tc+=(Math.random()-0.5)*tc*0.01; ohlc.push({x:t+i*60000, o, h:Math.max(o,tc)+1, l:Math.min(o,tc)-1, c:tc, v:1000}); }
        }
        
        setChartDataCache(prev => ({...prev, [gameState.timeframe]: ohlc}));
    };

    useEffect(() => {
        if(modalState !== 'chart' || !mainChartRef.current || !chartDataCache[gameState.timeframe]) return;
        const raw = chartDataCache[gameState.timeframe];
        const labels = raw.map(d => new Date(d.x).toLocaleTimeString('zh-TW', {hour:'2-digit', minute:'2-digit'}));
        const closePrices = raw.map(d => d.c);
        
        if(chartInsts.current.main) chartInsts.current.main.destroy();
        
        chartInsts.current.main = new Chart(mainChartRef.current, {
            type: 'line',
            data: { 
                labels: labels,
                datasets: [{ 
                    label: '價格走勢', data: closePrices, borderColor: '#eab308', backgroundColor: 'rgba(234, 179, 8, 0.1)',
                    borderWidth: 2, pointRadius: 0, fill: true, tension: 0.1
                }] 
            },
            options: { animation: false, responsive: true, maintainAspectRatio: false, scales: { x: { type: 'category', display: false, labels }, y: { position: 'right', ticks: { color: '#ccc' }, grid: { color: 'rgba(255,255,255,0.1)' } } }, plugins: { legend: { display: false } } }
        });

        if(volChartRef.current) {
            if(chartInsts.current.vol) chartInsts.current.vol.destroy();
            const volumeColors = raw.map(d => d.c >= d.o ? 'rgba(239, 68, 68, 0.7)' : 'rgba(34, 197, 94, 0.7)');
            chartInsts.current.vol = new Chart(volChartRef.current, {
                type: 'bar',
                data: { labels, datasets: [{ data: raw.map(d => d.v), backgroundColor: volumeColors, barPercentage: 0.8 }] },
                options: { animation: false, responsive: true, maintainAspectRatio: false, scales: { x: { display: false }, y: { display: false } }, plugins: { legend: { display: false } } }
            });
        }

        if(indChartRef.current) {
            if(chartInsts.current.ind) chartInsts.current.ind.destroy();
            let datasets = []; const ind = gameState.activeIndicator;
            let yScales = { y: { position: 'right', ticks: { color: '#888', font: { size: 8 } } } };
            
            if(ind === "MACD") {
                const {m, s, h} = calcMACD(closePrices);
                yScales = {
                    y: { type: 'linear', display: true, position: 'right', ticks: { color: '#fff', font: { size: 8 } } },
                    y1: { type: 'linear', display: true, position: 'left', ticks: { color: '#aaa', font: { size: 8 } }, grid: { drawOnChartArea: false } }
                };
                datasets = [
                    { type: 'bar', label: 'Hist', data: h, backgroundColor: h.map(v => v >= 0 ? '#ef4444' : '#22c55e'), yAxisID: 'y1' },
                    { type: 'line', label: 'MACD', data: m, borderColor: '#fff', borderWidth: 1.5, pointRadius: 0, tension: 0.1, yAxisID: 'y' },
                    { type: 'line', label: 'Signal', data: s, borderColor: '#facc15', borderWidth: 1.5, pointRadius: 0, tension: 0.1, yAxisID: 'y' }
                ];
            } else if(ind === "KD") {
                const {k, d} = calcKD(closePrices);
                datasets = [ { type: 'line', label: 'K', data: k, borderColor: '#38bdf8', borderWidth: 1.5, pointRadius: 0, tension: 0.1 }, { type: 'line', label: 'D', data: d, borderColor: '#fb923c', borderWidth: 1.5, pointRadius: 0, tension: 0.1 } ];
            } else if(ind === "RSI") {
                datasets = [ { type: 'line', label: 'RSI 5', data: calcRSI(closePrices, 5), borderColor: '#c084fc', borderWidth: 1.5, pointRadius: 0, tension: 0.1 }, { type: 'line', label: 'RSI 10', data: calcRSI(closePrices, 10), borderColor: '#38bdf8', borderWidth: 1.5, pointRadius: 0, tension: 0.1 } ];
            } else if(ind === "BIAS") {
                datasets = [ { type: 'line', label: 'BIAS 5', data: calcBIAS(closePrices, 5), borderColor: '#fff', borderWidth: 1.5, pointRadius: 0, tension: 0.1 }, { type: 'line', label: 'BIAS 10', data: calcBIAS(closePrices, 10), borderColor: '#facc15', borderWidth: 1.5, pointRadius: 0, tension: 0.1 }, { type: 'line', label: 'BIAS 20', data: calcBIAS(closePrices, 20), borderColor: '#ec4899', borderWidth: 1.5, pointRadius: 0, tension: 0.1 } ];
            }
            chartInsts.current.ind = new Chart(indChartRef.current, {
                data: { labels, datasets },
                options: { animation: false, responsive: true, maintainAspectRatio: false, scales: Object.assign({ x: { display: false } }, yScales), plugins: { legend: { display: true, position: 'top', labels: { color: '#888', font: { size: 8 } } } } }
            });
        }
    }, [chartDataCache, gameState.timeframe, gameState.activeIndicator, modalState, gameState.activeCity]);


    // ==========================================
    // 操作與狀態處理函數
    // ==========================================
    const handleSwitchSector = (code) => {
        setGameState({...gameState, activeSector: code, activeCity: sectors[code].cities[0] || ""});
    };

    const handleIssueOrder = (side) => {
        if (marketState === "CLOSED" && !isSimMode) { showMessage("休市期間僅開放沙盤下單"); triggerThunder('thunder'); return; }
        const vol = currentPrice * orderQty * 1000;
        const totalCost = vol + (vol * TAX_RATE) + (vol * FEE_RATE);
        
        if (gameState.balance < totalCost) { showMessage("存銀不足"); triggerThunder('thunder'); return; }
        
        const newUnit = { id: Date.now(), city: gameState.activeCity, side, qty: orderQty, cost: currentPrice, isSim: isSimMode, time: new Date().toLocaleTimeString('zh-TW', {hour12:false}) };
        const newState = { ...gameState, balance: gameState.balance - totalCost, units: [newUnit, ...gameState.units] };
        
        setGameState(newState); saveDataToCloud(newState);
        engineActions.current.syncPlayerTroops();
    };

    const handleSettle = (id) => {
        const u = gameState.units.find(x => x.id === id); if(!u) return;
        const cp = (isSimMode && u.isSim) ? currentPrice : safeNum(citiesData[u.city]?.price, u.cost);
        const pnl = calcProfit(u.side, u.cost, cp, u.qty);
        
        const newState = {
            ...gameState,
            balance: gameState.balance + (u.cost * u.qty * 1000) + pnl,
            realizedPnl: !isSimMode ? gameState.realizedPnl + pnl : gameState.realizedPnl,
            units: gameState.units.filter(x => x.id !== id),
            history: [{...u, pnl, exit: cp, time: new Date().toLocaleTimeString('zh-TW', {hour12:false})}, ...gameState.history]
        };
        setGameState(newState); saveDataToCloud(newState);
        engineActions.current.syncPlayerTroops();
        setReportPnl(pnl); setModalState('reportDetail');
    };

    const handleToggleSimMode = () => {
        if(marketState === "OPEN" && !isSimMode) { showMessage("開盤期間禁止沙盤"); return; }
        if(isSimMode) {
            handleCloseSimMode();
        } else {
            realStateSnapshot.current = JSON.parse(JSON.stringify(gameState));
            setIsSimMode(true);
            const newCities = {...citiesData};
            Object.keys(newCities).forEach(c => {
                newCities[c].simBasePrice = safeNum(newCities[c].price, newCities[c].basePrice);
                initKbars(newCities[c], newCities[c].simBasePrice);
            });
            setCitiesData(newCities);
            triggerThunder('sim'); showMessage("進入沙盤時空 資金獨立計算");
        }
    };

    const handleCloseSimMode = () => {
        if(!isSimMode) return;
        const simNet = gameState.balance + gameState.frozen;
        const realNet = realStateSnapshot.current.balance + realStateSnapshot.current.frozen;
        
        let simUnrealized = 0;
        gameState.units.forEach(u => { if (u.isSim) { const cp = safeNum(citiesData[u.city]?.price, u.cost); simUnrealized += calcProfit(u.side, u.cost, cp, u.qty); } });
        
        const simProfit = simNet - realNet + simUnrealized;
        let newState = JSON.parse(JSON.stringify(realStateSnapshot.current));
        realStateSnapshot.current = null; setIsSimMode(false);

        if (simProfit > 0) {
            const reward = Math.floor(simProfit * 0.001);
            newState.balance += reward;
            newState.history.unshift({ time: new Date().toLocaleTimeString('zh-TW', {hour12:false}), city: "沙盤練兵甘霖", side: "SYS", pnl: reward, isSim: false });
            setSimRewardData({ profit: simProfit, reward });
            setModalState('simReward');
        } else {
            triggerThunder('thunder'); showMessage("沙盤結束 本金還原");
        }
        
        setGameState(newState); saveDataToCloud(newState);
        engineActions.current.syncPlayerTroops(); fetchChartData();
    };

    const handleAddCustomStock = () => {
        const cleanSym = String(customSymbol).trim().toUpperCase().replace(/[^A-Z0-9\.]/g, ''); 
        const cleanName = String(customName).trim().replace(/[<>]/g, '');
        if (!cleanSym || !cleanName) { showMessage("請輸入有效台股代號"); return; }
        
        const newCities = {...citiesData};
        if (!newCities[cleanSym]) newCities[cleanSym] = { name: cleanName, price: 0, basePrice: 0, realPrice: 0, simBasePrice: 0, vol: 2.0, chartData: {}, autoSimTriggered: false };
        else newCities[cleanSym].name = cleanName;
        
        const newSectors = {...sectors};
        if (!newSectors["CUSTOM"].cities.includes(cleanSym)) newSectors["CUSTOM"].cities.push(cleanSym);
        
        setCitiesData(newCities); setSectors(newSectors); saveDataToCloud(gameState, newSectors, newCities);
        setCustomSymbol(''); setCustomName(''); showMessage(`已編列 ${cleanName}`);
    };

    const handleRemoveCustomStock = (sym) => {
        const newSectors = {...sectors};
        const idx = newSectors["CUSTOM"].cities.indexOf(sym);
        if (idx > -1) {
            newSectors["CUSTOM"].cities.splice(idx, 1);
            setSectors(newSectors); saveDataToCloud(gameState, newSectors, citiesData);
            showMessage(`已移出 ${sym}`);
        }
    };

    const handleFactoryReset = () => {
        if(window.confirm("確定要刪除所有自訂領域與城池，還原至出廠設定嗎？(您的國庫與戰報將保留)")) {
            initDefaultDatabase();
            setGameState(prev => ({ ...prev, activeSector: "SEMICON", activeCity: "2330" }));
            setModalState(null);
            showMessage("已還原原廠領域編制");
            setTimeout(() => window.location.reload(), 1000); 
        }
    };

    // ==========================================
    // UI 元件渲染
    // ==========================================
    if (isLoggingIn) return <div className="flex h-screen items-center justify-center bg-black text-white font-bold tracking-widest animate-pulse">連線天界中...</div>;

    if (!user) {
        return (
            <div className="flex h-screen items-center justify-center bg-[#02050a] text-white p-4">
                <style>{`body { background: #02050a; }`}</style>
                <div className="glass p-8 rounded-2xl max-w-sm w-full text-center border border-yellow-500/30 shadow-[0_0_30px_rgba(234,179,8,0.15)]">
                    <h1 className="text-3xl font-black mb-2 text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-yellow-600 tracking-widest">三界戰場</h1>
                    <p className="text-xs text-gray-400 mb-8 tracking-widest">傭兵統帥 登入大廳</p>
                    <button onClick={() => window.location.reload()} className="w-full bg-yellow-600 hover:bg-yellow-500 text-black font-black py-3 rounded-xl mb-4 transition-all shadow-lg active:scale-95 tracking-widest">一鍵匿名入伍</button>
                    <div className="border-t border-white/10 pt-4 mt-4 flex justify-around text-[10px] text-gray-500">
                        <div className="flex flex-col"><span>總進駐兵力</span><span className="text-gray-300 font-mono text-sm">{globalStats.totalUsers}</span></div>
                        <div className="flex flex-col"><span>今日活躍</span><span className="text-yellow-500 font-mono text-sm">{globalStats.todayActive}</span></div>
                    </div>
                </div>
            </div>
        );
    }

    const currentCityData = citiesData[gameState.activeCity];
    const activeBase = isSimMode ? safeNum(currentCityData?.simBasePrice) : safeNum(currentCityData?.basePrice);
    const displayPrice = currentPrice > 0 ? currentPrice : activeBase;
    const pct = activeBase > 0 ? ((displayPrice - activeBase) / activeBase * 100) : 0;
    
    // 計算浮動淨利
    let realUnrealized = 0, simUnrealized = 0;
    gameState.units.forEach(u => {
        const cp = isSimMode && u.isSim ? displayPrice : safeNum(citiesData[u.city]?.price, u.cost);
        const p = calcProfit(u.side, u.cost, cp, u.qty);
        if(u.isSim) simUnrealized += p; else realUnrealized += p;
    });

    return (
        <>
            <style>{`
                body { margin: 0; overflow: hidden; background: #02050a; font-family: 'Noto Sans TC', sans-serif; color: white; touch-action: none; }
                .three-canvas { display: block; position: absolute; top: 0; left: 0; z-index: -1; }
                .glass { background: rgba(10, 15, 25, 0.75); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.1); box-shadow: 0 4px 15px rgba(0,0,0,0.5); }
                .glass-sim { background: rgba(15, 23, 42, 0.85); backdrop-filter: blur(12px); border: 1px solid rgba(56, 189, 248, 0.3); box-shadow: 0 0 20px rgba(56, 189, 248, 0.1); }
                .ui-scroll-container { position: fixed; inset: 0; overflow-y: auto; overflow-x: hidden; z-index: 10; pointer-events: auto; }
                .ui-content-wrapper { display: flex; flex-direction: column; justify-content: space-between; min-height: 100%; padding: 0.5rem; gap: 0.5rem; padding-bottom: 2rem; }
                @media (min-width: 768px) { .ui-content-wrapper { padding: 1.5rem; gap: 1rem; } }
                .scrollbar-hide::-webkit-scrollbar { display: none; }
                .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
                .gold-coin { position: fixed; font-size: 24px; z-index: 9999; pointer-events: none; animation: fall linear forwards; }
                @keyframes fall { to { transform: translateY(110vh) rotate(720deg); opacity: 0; } }
                .thunder-flash { animation: thunder 0.5s ease-out; }
                .gold-thunder-flash { animation: goldThunder 0.8s ease-out; }
                .sim-thunder-flash { animation: simThunder 0.8s ease-out; }
                @keyframes thunder { 0% { background: rgba(255, 255, 255, 0); } 10% { background: rgba(255, 255, 255, 0.3); } 20% { background: rgba(255, 255, 255, 0); } 100% { background: rgba(255, 255, 255, 0); } }
                @keyframes goldThunder { 0% { background: rgba(234, 179, 8, 0); } 10% { background: rgba(234, 179, 8, 0.4); } 20% { background: rgba(234, 179, 8, 0); } 100% { background: rgba(234, 179, 8, 0); } }
                @keyframes simThunder { 0% { background: rgba(56, 189, 248, 0); } 10% { background: rgba(56, 189, 248, 0.4); } 20% { background: rgba(56, 189, 248, 0); } 100% { background: rgba(56, 189, 248, 0); } }
            `}</style>
            
            <div id="thunder-overlay" className={`fixed inset-0 pointer-events-none z-50 transition-colors duration-500 ${thunderType ? `${thunderType}-thunder-flash` : ''}`}></div>
            <div id="gold-rain-container" className="fixed inset-0 pointer-events-none z-[60] overflow-hidden">
                {goldRain && Array.from({length: 60}).map((_, i) => (
                    <div key={i} className="gold-coin" style={{ left: `${Math.random()*100}vw`, animationDuration: `${Math.random()*2+2}s`, animationDelay: `${Math.random()*0.5}s`, fontSize: `${Math.random()*20+15}px` }}>💰</div>
                ))}
            </div>
            
            <div className={`fixed top-16 left-1/2 -translate-x-1/2 bg-gray-900/95 backdrop-blur-md px-5 py-2.5 rounded-full text-sm font-bold transition-all duration-300 z-[60] pointer-events-none border border-white/20 text-white tracking-widest shadow-2xl ${toastMsg.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
                {toastMsg.text}
            </div>

            <div className="ui-scroll-container scrollbar-hide transition-all duration-500">
                <div className="ui-content-wrapper">
                    
                    {/* 頂部主控台 */}
                    <div className="w-full flex-none flex flex-col md:flex-row gap-2 justify-between items-start">
                        <div className={`rounded-xl p-3 w-full md:w-[26rem] shadow-lg transition-all duration-500 ${isSimMode ? 'glass-sim' : 'glass'}`}>
                            <div className="flex justify-between items-center mb-2">
                                <span className={`text-[10px] md:text-xs font-bold uppercase tracking-widest px-2 py-1 rounded border ${isSimMode ? 'text-sky-300 bg-sky-500/20 border-sky-500/30 animate-pulse' : (marketState==='OPEN'?'text-yellow-400 bg-yellow-500/20 border-yellow-500/30':'text-gray-400 bg-white/10 border-white/20')}`}>
                                    {isSimMode ? '沙盤推演 獨立時空' : (marketState === 'OPEN' ? '真實天道 運轉中' : '天道休市 盤後')}
                                </span>
                                <div className="flex gap-1.5">
                                    <button onClick={handleToggleSimMode} disabled={marketState==='OPEN' && !isSimMode} className={`px-2.5 py-1.5 rounded text-[10px] font-bold tracking-widest transition-all ${isSimMode ? 'bg-red-600 text-white hover:bg-red-500' : (marketState==='OPEN' ? 'bg-gray-700 text-gray-400 opacity-50 cursor-not-allowed' : 'bg-sky-600 text-white hover:bg-sky-500 shadow-[0_0_10px_rgba(2,132,199,0.5)] animate-pulse')}`}>
                                        {isSimMode ? '結束推演' : (marketState==='OPEN'?'沙盤(開盤禁用)':'啟動沙盤')}
                                    </button>
                                    <button onClick={() => { setModalState('chart'); fetchChartData(); }} className="bg-white/10 hover:bg-white/20 border border-white/20 px-2.5 py-1.5 rounded text-[10px] text-white font-bold tracking-widest transition-all">圖表</button>
                                    <button onClick={() => setModalState('summary')} className="bg-purple-900/50 hover:bg-purple-800 border border-purple-500/40 px-2.5 py-1.5 rounded text-[10px] text-purple-200 font-bold tracking-widest transition-all">大表</button>
                                </div>
                            </div>
                            
                            <div className="flex justify-between items-end mt-2">
                                <div>
                                    <div className="text-[10px] text-gray-400 mb-0.5 tracking-wider">人界存銀 天幣</div>
                                    <div className="text-2xl md:text-3xl font-mono font-black text-white">{Math.floor(gameState.balance).toLocaleString()}</div>
                                    <div className="text-[9px] text-gray-500 mt-0.5">凍結 {Math.floor(gameState.frozen).toLocaleString()}</div>
                                </div>
                                <div className="flex flex-col items-end">
                                    <span className={`text-[10px] font-bold uppercase tracking-wider mb-0.5 ${isSimMode?'text-sky-400 animate-pulse':'text-gray-400'}`}>
                                        {isSimMode ? '【待結算】沙盤淨利' : '【已入庫】累積淨利'}
                                    </span>
                                    <div className={`text-xl md:text-2xl font-black font-mono ${isSimMode?'text-sky-400 drop-shadow-[0_0_5px_rgba(56,189,248,0.5)]':(gameState.realizedPnl>=0?'text-red-500':'text-green-500')}`}>
                                        {isSimMode ? (simUnrealized>=0?'加 ':'減 ')+Math.abs(Math.floor(simUnrealized)).toLocaleString() : (gameState.realizedPnl>=0?'加 ':'減 ')+Math.abs(Math.floor(gameState.realizedPnl)).toLocaleString()}
                                    </div>
                                </div>
                            </div>
                            
                            <div className="mt-3 pt-3 border-t border-white/10 flex gap-2 items-center">
                                <select value={gameState.activeSector} onChange={e => handleSwitchSector(e.target.value)} className="bg-black/50 border border-white/20 rounded-lg px-2 py-1.5 text-[10px] md:text-xs font-bold text-gray-200 focus:outline-none w-24 md:w-auto">
                                    {Object.keys(sectors).map(k => <option key={k} value={k}>{sectors[k].name}</option>)}
                                </select>
                                <select value={gameState.activeCity} onChange={e => setGameState({...gameState, activeCity: e.target.value})} className="flex-1 bg-black/50 border border-white/20 rounded-lg px-2 py-1.5 text-[11px] md:text-sm font-bold text-white focus:outline-none truncate">
                                    {sectors[gameState.activeSector]?.cities.map(c => <option key={c} value={c}>{citiesData[c]?.name || c}</option>)}
                                </select>
                                <button onClick={() => setModalState('custom')} className="bg-white/10 hover:bg-white/20 p-1.5 rounded-lg text-white font-bold text-[10px]">⚙</button>
                            </div>
                            
                            <div className="flex justify-between items-center bg-black/40 p-2.5 rounded-lg mt-3 border border-white/10 shadow-inner">
                                <div className="flex items-baseline gap-2">
                                    <span className="text-2xl md:text-3xl font-mono font-black text-white">{displayPrice > 0 ? displayPrice.toFixed(2) : '--'}</span>
                                    <span className={`text-[10px] md:text-[11px] font-bold ${pct>=0?'text-red-500':'text-green-500'}`}>{Math.abs(pct).toFixed(2)} %</span>
                                </div>
                                <div className="text-right flex flex-col items-end">
                                    <span className="text-[9px] text-gray-500 uppercase font-bold tracking-widest mb-0.5">基準昨收</span>
                                    <span className="text-sm md:text-base font-mono font-bold text-gray-300">{activeBase > 0 ? activeBase.toFixed(2) : '--'}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div ref={threeContainerRef} className="flex-1 min-h-[40vh] w-full pointer-events-none absolute inset-0 -z-10" />

                    {/* 底部陣列與下單區 */}
                    <div className="w-full flex-none flex flex-col md:flex-row gap-2 mt-auto">
                        <div className={`rounded-xl flex flex-col w-full md:w-96 flex-none h-[35vh] md:h-[40vh] ${isSimMode ? 'glass-sim' : 'glass'}`}>
                            <div className="flex border-b border-white/10 flex-none">
                                <button onClick={()=>setActiveTab('units')} className={`text-xs px-3 py-1.5 border-b-2 transition-all flex-1 text-center font-bold ${activeTab==='units'?'border-yellow-500 text-yellow-500':'border-transparent text-gray-500'}`}>戰力整編</button>
                                <button onClick={()=>setActiveTab('history')} className={`text-xs px-3 py-1.5 border-b-2 transition-all flex-1 text-center font-bold ${activeTab==='history'?'border-yellow-500 text-yellow-500':'border-transparent text-gray-500'}`}>戰紀</button>
                            </div>
                            <div className="p-2 flex-1 overflow-y-auto scrollbar-hide">
                                {activeTab === 'units' && gameState.units.filter(u => u.isSim === isSimMode).map(u => {
                                    const p = calcProfit(u.side, u.cost, displayPrice, u.qty);
                                    return (
                                        <div key={u.id} className={`bg-black/40 p-2 rounded-lg border-r-4 ${p>=0?'border-red-500':'border-green-500'} mb-2 ml-2`}>
                                            <div className="flex justify-between text-xs">
                                                <span>{citiesData[u.city]?.name} {u.side==='LONG'?'做多':'做空'} {u.qty}營</span>
                                                <span className={p>=0?'text-red-400':'text-green-400'}>{Math.floor(p).toLocaleString()}</span>
                                            </div>
                                            <div className="flex justify-between items-center mt-1">
                                                <span className="text-[9px] text-gray-500">進場 {u.cost.toFixed(2)}</span>
                                                <button onClick={()=>handleSettle(u.id)} className="text-[10px] bg-white/10 px-3 py-1 rounded">結算</button>
                                            </div>
                                        </div>
                                    )
                                })}
                                {activeTab === 'history' && gameState.history.map((h, i) => (
                                    <div key={`${h.time}_${i}`} className="bg-black/30 rounded-lg p-2.5 border-r-2 border-gray-600 text-right text-[10px] mb-2 opacity-80">
                                        <span className="text-gray-500 font-mono mr-2">{h.time}</span>
                                        <span className="text-gray-300 mr-2">{citiesData[h.city]?.name || h.city}</span>
                                        <span className={`font-mono font-bold ${h.pnl>=0?'text-red-400':'text-green-400'}`}>{Math.floor(h.pnl).toLocaleString()}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div id="order-panel" className={`rounded-xl p-3 md:p-4 flex flex-col w-full md:flex-1 justify-center gap-3 ${isSimMode ? 'glass-sim' : 'glass'}`}>
                            <div className="flex gap-3">
                                <div className="flex flex-col flex-1">
                                    <span className="text-[10px] text-gray-400 font-bold uppercase mb-1 ml-1 tracking-widest">派遣營數</span>
                                    <input type="number" value={orderQty} onChange={e=>setOrderQty(e.target.value)} min="1" className="rounded-lg px-3 py-2 text-lg md:text-xl font-bold outline-none text-center text-white font-mono w-full bg-black/40 border border-white/20"/>
                                </div>
                            </div>
                            <div className="flex gap-3 mt-1">
                                <button onClick={()=>handleIssueOrder('LONG')} disabled={marketState==='CLOSED'&&!isSimMode} className={`flex-1 bg-gradient-to-b from-red-600 to-red-800 hover:from-red-500 rounded-xl py-3 flex flex-col items-center justify-center border-b-2 border-red-900 shadow-lg ${marketState==='CLOSED'&&!isSimMode?'opacity-50 grayscale':''}`}>
                                    <span className="text-[10px] font-bold text-red-200 tracking-widest mb-0.5">護國多軍</span>
                                    <span className="text-base md:text-xl font-black text-white drop-shadow-md">入城</span>
                                </button>
                                <button onClick={()=>handleIssueOrder('SHORT')} disabled={marketState==='CLOSED'&&!isSimMode} className={`flex-1 bg-gradient-to-b from-green-600 to-green-800 hover:from-green-500 rounded-xl py-3 flex flex-col items-center justify-center border-b-2 border-green-900 shadow-lg ${marketState==='CLOSED'&&!isSimMode?'opacity-50 grayscale':''}`}>
                                    <span className="text-[10px] font-bold text-green-200 tracking-widest mb-0.5">掠奪空軍</span>
                                    <span className="text-base md:text-xl font-black text-white drop-shadow-md">攻掠</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Modals */}
            {modalState === 'chart' && (
                <div className="fixed inset-0 z-40 bg-[#02050a] flex flex-col transition-all duration-300">
                    <div className="flex justify-between items-center p-3 border-b border-white/10 bg-gray-900/80">
                        <h2 className="text-base font-black text-white tracking-widest">軍師戰略室</h2>
                        <button onClick={() => setModalState(null)} className="bg-white/10 px-3 py-1.5 rounded-lg text-xs font-bold text-white">返回戰場</button>
                    </div>
                    <div className="flex-1 p-2 md:p-4 overflow-y-auto flex flex-col gap-2">
                        <div className="glass rounded-xl p-3 flex-1 flex flex-col gap-2">
                            <div className="flex justify-between items-center bg-black/40 p-2 rounded-xl border border-white/10">
                                <div className="text-lg font-black tracking-wider text-white px-2">{citiesData[gameState.activeCity]?.name}</div>
                                <div className="flex gap-1 overflow-x-auto scrollbar-hide">
                                    {['1m','5m','15m','30m','60m','1d','1wk','1mo'].map(tf => (
                                        <button key={tf} onClick={() => { setGameState({...gameState, timeframe: tf}); }} className={`text-[11px] px-2 py-1 rounded transition-all ${gameState.timeframe===tf?'bg-yellow-500 text-black font-black':'border border-white/10 text-white'}`}>{tf}</button>
                                    ))}
                                </div>
                            </div>
                            <div className="flex-1 min-h-[40vh] bg-black/50 border border-white/10 p-2 rounded-xl relative">
                                <canvas ref={mainChartRef}></canvas>
                            </div>
                            <div className="h-[12vh] bg-black/50 border border-white/10 p-2 rounded-xl relative">
                                <canvas ref={volChartRef}></canvas>
                            </div>
                            <div className="h-[25vh] bg-black/50 border border-white/10 p-2 rounded-xl relative flex flex-col">
                                <div className="flex gap-2 absolute top-2 left-3 z-10">
                                    {['MACD','KD','RSI','BIAS'].map(ind => (
                                        <button key={ind} onClick={() => setGameState({...gameState, activeIndicator: ind})} className={`text-[10px] px-3 py-1 rounded-lg border transition-all ${gameState.activeIndicator===ind?'bg-blue-500 text-white border-blue-500 font-bold':'bg-black/30 text-gray-400 border-white/20'}`}>{ind}</button>
                                    ))}
                                </div>
                                <div className="flex-1 mt-8 relative">
                                    <canvas ref={indChartRef}></canvas>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {modalState === 'custom' && (
                <div className="fixed inset-0 bg-black/90 backdrop-blur-xl flex items-center justify-center z-50 p-4">
                    <div className="glass rounded-2xl p-5 w-full max-w-md shadow-2xl flex flex-col max-h-[90vh]">
                        <h2 className="text-xl font-black tracking-widest text-center mb-4 text-white">⚙ 統帥設定總機</h2>
                        
                        <div className="bg-black/40 p-3 rounded-xl border border-white/10 mb-4">
                            <h3 className="text-xs text-yellow-400 font-bold mb-2">🔑 API 金鑰配置 (解決連線延遲)</h3>
                            <input type="text" value={gameState.apiKey} onChange={e => setGameState({...gameState, apiKey: e.target.value})} placeholder="請輸入您的金鑰..." className="w-full bg-black/60 border border-white/20 rounded-lg px-3 py-2 text-white text-xs mb-2"/>
                            <p className="text-[9px] text-gray-500 leading-relaxed">提供個人專屬 API Key 可避開免費節點限制，享受極速報價。留空則使用系統免費備援。</p>
                        </div>

                        <div className="bg-black/40 p-4 rounded-xl border border-white/10">
                            <h3 className="text-xs text-sky-400 font-bold uppercase tracking-widest mb-3 border-b border-white/10 pb-1">➕ 編列新城池</h3>
                            <div className="flex gap-2">
                                <input type="text" value={customSymbol} onChange={e=>setCustomSymbol(e.target.value)} placeholder="台股代號" className="w-1/3 bg-black/60 border border-white/20 rounded-lg px-3 py-2 text-white outline-none font-mono text-xs uppercase"/>
                                <input type="text" value={customName} onChange={e=>setCustomName(e.target.value)} placeholder="城池名稱" className="w-2/3 bg-black/60 border border-white/20 rounded-lg px-3 py-2 text-white outline-none text-xs"/>
                            </div>
                            <button onClick={handleAddCustomStock} className="w-full bg-sky-600 hover:bg-sky-500 py-2 rounded-lg font-bold text-xs mt-2 transition-all shadow-lg text-white">駐紮入軍</button>
                        </div>
                        
                        <div className="mt-4 max-h-32 overflow-y-auto pr-1">
                            {sectors["CUSTOM"]?.cities.map(sym => (
                                <div key={sym} className="flex justify-between items-center bg-black/40 p-2 rounded-lg border border-white/5 mb-2">
                                    <div className="flex flex-col"><span className="text-xs text-yellow-500 font-bold">{sym}</span><span className="text-[10px] text-gray-400">{citiesData[sym]?.name}</span></div>
                                    <button onClick={()=>handleRemoveCustomStock(sym)} className="text-[10px] bg-red-900/50 text-red-200 px-3 py-1 rounded">移除</button>
                                </div>
                            ))}
                        </div>

                        <div className="flex gap-3 mt-auto pt-4 border-t border-white/10">
                            <button onClick={handleFactoryReset} className="w-1/3 bg-red-900/50 hover:bg-red-800 py-3 rounded-xl text-xs text-red-200 font-bold">還原預設</button>
                            <button onClick={()=>{setModalState(null); saveDataToCloud();}} className="w-2/3 bg-gray-700 hover:bg-gray-600 py-3 rounded-xl text-sm text-white font-bold tracking-widest">完成配置</button>
                        </div>
                    </div>
                </div>
            )}
            
            {modalState === 'summary' && (
                <div className="fixed inset-0 bg-black/90 backdrop-blur-xl flex items-center justify-center z-50 p-4">
                    <div className="glass rounded-2xl p-6 w-full max-w-md border border-purple-500/40 shadow-[0_0_30px_rgba(168,85,247,0.15)] text-center">
                        <h2 className="text-xl font-black mb-4 tracking-widest text-purple-300">實戰結算大表</h2>
                        <div className="space-y-4 bg-black/40 p-5 rounded-2xl border border-purple-500/20 text-sm mb-6 text-left">
                            <div className="flex justify-between border-b border-white/10 pb-2"><span className="text-gray-400 font-bold tracking-widest">【未平倉】浮動淨利</span><span className={`font-mono font-bold ${realUnrealized>=0?'text-red-400':'text-green-400'}`}>{Math.floor(realUnrealized).toLocaleString()}</span></div>
                            <div className="flex justify-between border-b border-white/10 pb-2"><span className="text-gray-400 font-bold tracking-widest">【已入庫】實現淨利</span><span className={`font-mono font-bold ${gameState.realizedPnl>=0?'text-red-500':'text-green-500'}`}>{Math.floor(gameState.realizedPnl).toLocaleString()}</span></div>
                        </div>
                        <button onClick={()=>setModalState(null)} className="w-full bg-purple-600 hover:bg-purple-500 py-3 rounded-xl font-black text-sm text-white">關閉</button>
                    </div>
                </div>
            )}
            
            {modalState === 'simReward' && simRewardData && (
                <div className="fixed inset-0 bg-black/90 backdrop-blur-xl flex items-center justify-center z-50 p-4">
                    <div className="glass rounded-2xl p-6 w-full max-w-md border border-yellow-500/40 shadow-[0_0_40px_rgba(234,179,8,0.3)] text-center">
                        <div className="text-6xl mb-4">🌧️💰</div>
                        <h2 className="text-2xl font-black mb-2 tracking-widest text-yellow-400">天降甘霖 戰報結算</h2>
                        <p className="text-xs text-gray-300 mb-6">統帥的沙盤推演，已轉化為真實世界的獎勵</p>
                        <div className="space-y-3 bg-black/50 p-4 rounded-xl border border-yellow-500/20 mb-6 text-left">
                            <div className="flex justify-between items-center"><span className="text-gray-400 text-sm tracking-widest">沙盤推演淨利</span><span className="text-white font-mono">{Math.floor(simRewardData.profit).toLocaleString()}</span></div>
                            <div className="flex justify-between items-center"><span className="text-gray-400 text-sm tracking-widest">獲得天幣甘霖</span><span className="text-4xl text-yellow-400 font-black font-mono drop-shadow-md">{simRewardData.reward.toLocaleString()}</span></div>
                        </div>
                        <button onClick={()=>{setModalState(null); playGoldRain();}} className="w-full bg-gradient-to-r from-yellow-600 to-yellow-500 py-3 rounded-xl font-black text-sm text-black shadow-lg">收下天幣</button>
                    </div>
                </div>
            )}
            
            {modalState === 'reportDetail' && (
                <div className="fixed inset-0 bg-black/90 backdrop-blur-xl flex items-center justify-center z-50 p-4">
                    <div className="glass rounded-2xl p-6 w-full max-w-md border border-gray-500/40 shadow-2xl text-center">
                        <h2 className="text-xl font-black mb-4 tracking-widest text-white">結算紀實</h2>
                        <div className="text-center mb-6">
                            <span className="text-xs text-gray-400">平倉淨利</span>
                            <div className={`text-4xl font-black mt-2 ${reportPnl>=0?'text-red-500 drop-shadow-[0_0_8px_rgba(239,68,68,0.4)]':'text-green-500 drop-shadow-[0_0_8px_rgba(34,197,94,0.4)]'}`}>
                                {reportPnl>=0?'加 ':'減 '}{Math.abs(Math.floor(reportPnl)).toLocaleString()}
                            </div>
                        </div>
                        <button onClick={()=>setModalState(null)} className="w-full bg-gray-600 hover:bg-gray-500 py-3 rounded-xl font-black text-sm text-white shadow-lg">關閉</button>
                    </div>
                </div>
            )}
        </>
    );
}