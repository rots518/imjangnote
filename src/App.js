import React, { useState, useRef, useMemo, useEffect } from 'react';
import { 
  MapPin, Camera, Calendar, ChevronLeft, Plus, List as ListIcon, 
  Trash2, Image as ImageIcon, Building, Search, Users, Map, 
  Train, Home, Coffee, MessageCircle, Loader2, Filter, Edit, Navigation, RefreshCw, X,
  FileText, DoorOpen, Bath, Maximize, Clock
} from 'lucide-react';

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, onSnapshot, deleteDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore'; 
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyBgyVX8PC2Su6mN8yIToC4tDNXOqylxvhk",
  authDomain: "imjangnote-271b1.firebaseapp.com",
  projectId: "imjangnote-271b1",
  storageBucket: "imjangnote-271b1.firebasestorage.app",
  messagingSenderId: "918718315056",
  appId: "1:918718315056:web:e93d865856cfe7c1530bf5"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

// 주요 길찾기 거점 목록
const POI_LIST = [
  { name: '서울역', category: '상권', x: 126.9706, y: 37.5546 },
  { name: '강남역', category: '상권', x: 127.0276, y: 37.4979 },
  { name: '신논현역', category: '상권', x: 127.0250, y: 37.5045 },
  { name: '여의도역', category: '상권', x: 126.9243, y: 37.5215 },
  { name: '압구정로데오역', category: '회사', x: 127.0405, y: 37.5273 },
  { name: '신용산역', category: '회사', x: 126.9678, y: 37.5290 }
];

const getStraightDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; 
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

const compressImage = (file, maxSizeMB = 1, maxWidthOrHeight = 1920) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > height) {
          if (width > maxWidthOrHeight) { height = Math.round((height *= maxWidthOrHeight / width)); width = maxWidthOrHeight; }
        } else {
          if (height > maxWidthOrHeight) { width = Math.round((width *= maxWidthOrHeight / height)); height = maxWidthOrHeight; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if (!blob) reject(new Error('Canvas to Blob failed'));
          else resolve(new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".jpeg", { type: 'image/jpeg', lastModified: Date.now() }));
        }, 'image/jpeg', 0.8);
      };
    };
  });
};

export default function App() {
  const [entries, setEntries] = useState([]);
  const [currentView, setCurrentView] = useState('list');
  const [selectedEntryId, setSelectedEntryId] = useState(null);
  const [detailTab, setDetailTab] = useState('memo');
  const [expandedImage, setExpandedImage] = useState(null);
  
  const [isLoading, setIsLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPoiLoading, setIsPoiLoading] = useState(false);
  
  const [filterRegion, setFilterRegion] = useState('전체');
  const [filterDistrict, setFilterDistrict] = useState('전체');

  // 기록 작성 폼 상태
  const [newName, setNewName] = useState('');
  const [newRegion, setNewRegion] = useState('');
  const [newDistrict, setNewDistrict] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newHouseholds, setNewHouseholds] = useState('');
  const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0]);
  const [memoTransport, setMemoTransport] = useState('');
  const [memoCondition, setMemoCondition] = useState('');
  const [memoSurroundings, setMemoSurroundings] = useState('');
  const [memoVibe, setMemoVibe] = useState('');
  const [existingImages, setExistingImages] = useState([]); 
  const [newImageFiles, setNewImageFiles] = useState([]); 
  const [newImagePreviews, setNewImagePreviews] = useState([]); 
  const [isEditMode, setIsEditMode] = useState(false); 

  // 매물 작성 폼 상태
  const [isPropFormOpen, setIsPropFormOpen] = useState(false);
  const [propEditId, setPropEditId] = useState(null);
  const [propPrice, setPropPrice] = useState('');
  const [propArea, setPropArea] = useState('');
  const [propType, setPropType] = useState('계단식');
  const [propRooms, setPropRooms] = useState('');
  const [propBaths, setPropBaths] = useState('');
  const [propFloor, setPropFloor] = useState('');
  const [propNotes, setPropNotes] = useState('');
  
  const fileInputRef = useRef(null);

  // 🔴 중요: 여기에 실제 카카오 REST API 키를 넣으세요!
  const KAKAO_REST_API_KEY = 'ec73b276eedaefb216ac1a88193e13c4';

  // Firestore 실시간 동기화
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'imjang_notes'), (snapshot) => {
      setEntries(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0)));
      setIsLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // 현재 보고 있는 엔트리 실시간 추적 (업데이트 시 화면 즉시 반영 위함)
  const currentEntry = entries.find(e => e.id === selectedEntryId);

  const availableRegions = ['전체', ...new Set(entries.map(e => e.region).filter(Boolean))];
  const availableDistricts = useMemo(() => {
    if (filterRegion === '전체') return ['전체'];
    return ['전체', ...new Set(entries.filter(e => e.region === filterRegion).map(e => e.district).filter(Boolean))];
  }, [filterRegion, entries]);

  const filteredEntries = useMemo(() => {
    return entries.filter(entry => {
      if (filterRegion !== '전체' && entry.region !== filterRegion) return false;
      if (filterDistrict !== '전체' && entry.district !== filterDistrict) return false;
      return true;
    });
  }, [entries, filterRegion, filterDistrict]);

  const goToList = () => { setCurrentView('list'); setSelectedEntryId(null); setIsEditMode(false); setIsPropFormOpen(false); };
  const goToDetail = (entry) => { setSelectedEntryId(entry.id); setDetailTab('memo'); setCurrentView('detail'); setIsPropFormOpen(false); };

  const goToAdd = () => {
    setNewName(''); setNewRegion(''); setNewDistrict(''); setNewAddress(''); setNewHouseholds('');
    setNewDate(new Date().toISOString().split('T')[0]);
    setMemoTransport(''); setMemoCondition(''); setMemoSurroundings(''); setMemoVibe('');
    setExistingImages([]); setNewImageFiles([]); setNewImagePreviews([]);
    setIsEditMode(false); setCurrentView('add');
  };

  const goToEdit = () => {
    if(!currentEntry) return;
    setNewName(currentEntry.name); setNewRegion(currentEntry.region); setNewDistrict(currentEntry.district);
    setNewAddress(currentEntry.address || ''); setNewHouseholds(currentEntry.households || '');
    setNewDate(currentEntry.date || new Date().toISOString().split('T')[0]);
    setMemoTransport(currentEntry.memo?.transport || ''); setMemoCondition(currentEntry.memo?.condition || '');
    setMemoSurroundings(currentEntry.memo?.surroundings || ''); setMemoVibe(currentEntry.memo?.vibe || '');
    setExistingImages(currentEntry.images || []); setNewImageFiles([]); setNewImagePreviews([]);
    setIsEditMode(true); setCurrentView('add');
  };

  const handleImageChange = async (e) => {
    const files = Array.from(e.target.files);
    try {
      const compressedFiles = await Promise.all(files.map(file => compressImage(file, 1, 1920)));
      setNewImageFiles(prev => [...prev, ...compressedFiles]);
      setNewImagePreviews(prev => [...prev, ...compressedFiles.map(file => URL.createObjectURL(file))]);
    } catch (error) { alert('이미지 처리 중 오류 발생'); }
  };

  const removeNewImage = (idx) => {
    setNewImageFiles(prev => prev.filter((_, i) => i !== idx));
    setNewImagePreviews(prev => prev.filter((_, i) => i !== idx));
  };
  const removeExistingImage = (idx) => setExistingImages(prev => prev.filter((_, i) => i !== idx));

  const handleSearch = async () => {
    if (!newName.trim()) { alert('단지명을 입력해주세요.'); return; }
    if (KAKAO_REST_API_KEY.includes('실제_REST_API_키')) { alert('코드에 카카오 REST API 키를 입력해주세요!'); return; }

    setIsSearching(true);
    try {
      const response = await fetch(`https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(newName)}`, {
        headers: { Authorization: `KakaoAK ${KAKAO_REST_API_KEY}` }
      });
      const data = await response.json();
      if (data.documents && data.documents.length > 0) {
        const place = data.documents[0];
        setNewAddress(place.road_address_name || place.address_name);
        const parts = place.address_name.split(' ');
        if (parts.length >= 2) { setNewRegion(parts[0]); setNewDistrict(parts[1]); }
        alert('주소 검색 성공! 세대수를 입력해주세요.');
      } else { alert('검색 결과가 없습니다.'); }
    } catch (error) { alert('검색 중 오류 발생'); } finally { setIsSearching(false); }
  };

  const handleSave = async () => {
    if (!newName.trim() || !newRegion) { alert('단지명과 주소를 확인해주세요.'); return; }
    setIsSaving(true);
    try {
      const uploadedImageUrls = [];
      for (const file of newImageFiles) {
        const fileRef = ref(storage, `imjang_photos/${Date.now()}_${file.name}`);
        await uploadBytes(fileRef, file);
        uploadedImageUrls.push(await getDownloadURL(fileRef));
      }
      const entryData = {
        name: newName, region: newRegion, district: newDistrict, address: newAddress, households: newHouseholds, date: newDate,
        memo: { transport: memoTransport, condition: memoCondition, surroundings: memoSurroundings, vibe: memoVibe },
        images: [...existingImages, ...uploadedImageUrls]
      };

      if (isEditMode) {
        await updateDoc(doc(db, 'imjang_notes', currentEntry.id), entryData);
      } else {
        entryData.createdAt = serverTimestamp();
        entryData.properties = []; // 새 기록 생성 시 매물 배열 초기화
        await addDoc(collection(db, 'imjang_notes'), entryData);
      }
      goToList();
    } catch (error) { alert('저장 실패'); } finally { setIsSaving(false); }
  };

  const handleDelete = async (id) => {
    if (window.confirm('이 기록을 삭제하시겠습니까?')) {
      try { await deleteDoc(doc(db, 'imjang_notes', id)); goToList(); } catch (e) { alert('삭제 실패'); }
    }
  };

  // ================= 🚀 API 실시간 데이터 업데이트 및 저장 로직 =================
  const updateApiData = async () => {
    if (KAKAO_REST_API_KEY.includes('실제_REST_API_키')) { alert('카카오 REST API 키를 입력해주세요!'); return; }
    if (!currentEntry?.address) { alert('주소 정보가 없어 분석할 수 없습니다.'); return; }

    setIsPoiLoading(true);
    try {
      const localRes = await fetch(`https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(currentEntry.address)}`, {
        headers: { Authorization: `KakaoAK ${KAKAO_REST_API_KEY}` }
      });
      const localData = await localRes.json();
      if (!localData.documents?.[0]) { alert('좌표를 찾을 수 없습니다.'); setIsPoiLoading(false); return; }
      
      const { x: originX, y: originY } = localData.documents[0];
      
      let nearestSubway = null;
      try {
        const subwayRes = await fetch(`https://dapi.kakao.com/v2/local/search/category.json?category_group_code=SW8&x=${originX}&y=${originY}&sort=distance`, {
          headers: { Authorization: `KakaoAK ${KAKAO_REST_API_KEY}` }
        });
        const subwayData = await subwayRes.json();
        if (subwayData.documents?.[0]) {
          const nearest = subwayData.documents[0];
          nearestSubway = { name: nearest.place_name, distance: parseInt(nearest.distance, 10), walkTime: Math.ceil(parseInt(nearest.distance, 10) / 67) };
        }
      } catch(e) { console.error(e); }

      const results = {};
      for (const poi of POI_LIST) {
        const dist = getStraightDistance(originY, originX, poi.y, poi.x);
        let driveTime = null;
        try {
          const naviRes = await fetch(`https://apis-navi.kakaomobility.com/v1/directions?origin=${originX},${originY}&destination=${poi.x},${poi.y}`, {
            headers: { Authorization: `KakaoAK ${KAKAO_REST_API_KEY}` }
          });
          const naviData = await naviRes.json();
          if (naviData.routes?.[0]) driveTime = Math.ceil(naviData.routes[0].summary.duration / 60);
        } catch(e) { console.error(e); }
        results[poi.name] = { straightDist: dist.toFixed(1), driveTime: driveTime };
      }

      // 분석 데이터 생성 및 날짜 기록
      const analysisData = {
        nearestSubway,
        poiResults: results,
        lastUpdated: new Date().toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      };

      // Firestore에 분석 결과 영구 저장
      await updateDoc(doc(db, 'imjang_notes', currentEntry.id), { analysisData });
      
    } catch (e) { alert("API 업데이트 실패"); } finally { setIsPoiLoading(false); }
  };

  // ================= 🏠 매물 관리 CRUD 로직 =================
  const resetPropForm = () => {
    setPropPrice(''); setPropArea(''); setPropType('계단식'); setPropRooms(''); setPropBaths(''); setPropFloor(''); setPropNotes('');
    setPropEditId(null); setIsPropFormOpen(false);
  };

  const handleSaveProperty = async () => {
    if(!propPrice.trim()) { alert('매매가/전세가를 입력해주세요.'); return; }
    const newProp = {
      id: propEditId || Date.now().toString(),
      price: propPrice, area: propArea, type: propType, rooms: propRooms, baths: propBaths, floor: propFloor, notes: propNotes,
      updatedAt: new Date().toLocaleDateString()
    };
    
    let updatedProps = currentEntry.properties || [];
    if(propEditId) {
      updatedProps = updatedProps.map(p => p.id === propEditId ? newProp : p);
    } else {
      updatedProps.push(newProp);
    }

    try {
      await updateDoc(doc(db, 'imjang_notes', currentEntry.id), { properties: updatedProps });
      resetPropForm();
    } catch(e) { alert('매물 저장 실패'); }
  };

  const handleDeleteProperty = async (propId) => {
    if(window.confirm('이 매물을 삭제하시겠습니까?')) {
      const updatedProps = (currentEntry.properties || []).filter(p => p.id !== propId);
      await updateDoc(doc(db, 'imjang_notes', currentEntry.id), { properties: updatedProps });
    }
  };

  const openEditProperty = (prop) => {
    setPropPrice(prop.price); setPropArea(prop.area || ''); setPropType(prop.type || '계단식');
    setPropRooms(prop.rooms || ''); setPropBaths(prop.baths || ''); setPropFloor(prop.floor || ''); setPropNotes(prop.notes || '');
    setPropEditId(prop.id); setIsPropFormOpen(true);
  };

  // =========================================================================

  const renderList = () => (
    <div className="flex-1 overflow-y-auto bg-gray-50 flex flex-col">
      <div className="bg-white px-5 pt-6 pb-4 border-b border-gray-100 sticky top-0 z-10">
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2 mb-4"><Building className="text-blue-600" size={24} /> 우리의 임장 노트</h2>
        <div className="space-y-3">
          <div className="flex items-center gap-2"><Filter size={16} className="text-gray-400" /><span className="text-xs font-semibold text-gray-500">지역 선택</span></div>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {availableRegions.map(region => (
              <button key={region} onClick={() => { setFilterRegion(region); setFilterDistrict('전체'); }} className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap ${filterRegion === region ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-100 text-gray-600'}`}>{region}</button>
            ))}
          </div>
          {filterRegion !== '전체' && (
            <div className="flex gap-2 overflow-x-auto pb-1 pt-1 scrollbar-hide">
              {availableDistricts.map(district => (
                <button key={district} onClick={() => setFilterDistrict(district)} className={`px-3 py-1 rounded-md text-xs font-medium whitespace-nowrap ${filterDistrict === district ? 'bg-gray-800 text-white' : 'bg-white border text-gray-600'}`}>{district}</button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="p-4 space-y-4 pb-24 flex-1">
        <div className="text-sm font-medium text-gray-500 mb-2">검색 결과 <span className="text-blue-600">{filteredEntries.length}</span>건</div>
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 text-blue-500"><Loader2 size={40} className="animate-spin mb-4" /><p>로딩 중...</p></div>
        ) : filteredEntries.length === 0 ? (
          <div className="text-center py-20"><Map className="mx-auto text-gray-300 mb-3" size={48} /><p>등록된 기록이 없습니다.</p></div>
        ) : (
          filteredEntries.map(entry => (
            <div key={entry.id} onClick={() => goToDetail(entry)} className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 cursor-pointer active:scale-[0.98]">
              <div className="flex flex-col gap-1 mb-2">
                <div className="flex gap-1.5 mb-1">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-sm bg-blue-50 text-blue-600">{entry.region}</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-sm bg-gray-100 text-gray-600">{entry.district}</span>
                </div>
                <h3 className="text-lg font-bold text-gray-900 leading-tight">{entry.name}</h3>
                {entry.address && <p className="text-xs text-gray-500 mt-1 flex items-center gap-1"><MapPin size={12} /> {entry.address}</p>}
              </div>
              <div className="flex gap-3 mt-4 items-center justify-between">
                <div className="flex gap-2">
                  {entry.households && <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-600 bg-gray-50 px-2 py-1 rounded-md"><Users size={12} /> {entry.households}세대</span>}
                  {entry.properties?.length > 0 && <span className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 bg-indigo-50 px-2 py-1 rounded-md"><Home size={12} /> 매물 {entry.properties.length}건</span>}
                </div>
                <span className="text-[11px] font-medium text-gray-400">{entry.date}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );

  const renderDetail = () => {
    if (!currentEntry) return null;
    const { analysisData, properties = [] } = currentEntry;

    return (
      <div className="flex-1 overflow-y-auto bg-white flex flex-col h-full">
        <div className="sticky top-0 bg-white/90 backdrop-blur-md border-b border-gray-100 p-4 flex items-center justify-between z-20">
          <button onClick={goToList} className="p-2 -ml-2 text-gray-600 rounded-full"><ChevronLeft size={24} /></button>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold px-2 py-1 bg-blue-50 text-blue-600 rounded-md">{currentEntry.region}</span>
            <span className="text-xs font-bold px-2 py-1 bg-gray-100 text-gray-600 rounded-md">{currentEntry.district}</span>
          </div>
          <div className="flex gap-1">
            <button onClick={goToEdit} className="text-blue-500 p-2"><Edit size={20} /></button>
            <button onClick={() => handleDelete(currentEntry.id)} className="text-red-500 p-2"><Trash2 size={20} /></button>
          </div>
        </div>

        <div className="p-6 pb-20">
          <h1 className="text-2xl font-bold text-gray-900 mb-3">{currentEntry.name}</h1>
          <div className="flex flex-col gap-2 text-sm text-gray-600 bg-gray-50 p-4 rounded-xl mb-6">
            {currentEntry.address && <span className="flex items-center gap-2"><Map size={16} className="text-blue-500"/> {currentEntry.address}</span>}
            <div className="flex gap-4 mt-1">
              {currentEntry.households && <span className="flex items-center gap-2"><Users size={16} className="text-blue-500"/> {currentEntry.households}세대</span>}
              <span className="flex items-center gap-2"><Calendar size={16} className="text-blue-500"/> {currentEntry.date}</span>
            </div>
          </div>

          <div className="flex border-b border-gray-200 mb-6">
            <button onClick={() => setDetailTab('memo')} className={`flex-1 py-3 text-sm font-bold flex justify-center items-center gap-2 border-b-2 transition-all ${detailTab === 'memo' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400'}`}><MessageCircle size={16} /> 메모</button>
            <button onClick={() => setDetailTab('props')} className={`flex-1 py-3 text-sm font-bold flex justify-center items-center gap-2 border-b-2 transition-all ${detailTab === 'props' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-400'}`}><Home size={16} /> 매물 <span className="bg-indigo-100 text-indigo-700 text-[10px] px-1.5 rounded-full">{properties.length}</span></button>
            <button onClick={() => setDetailTab('analysis')} className={`flex-1 py-3 text-sm font-bold flex justify-center items-center gap-2 border-b-2 transition-all ${detailTab === 'analysis' ? 'border-emerald-600 text-emerald-600' : 'border-transparent text-gray-400'}`}><Navigation size={16} /> 분석</button>
          </div>

          {/* 📝 임장 메모 탭 */}
          {detailTab === 'memo' && (
            <div className="animate-in fade-in duration-300">
              {currentEntry.images?.length > 0 && (
                <div className="mb-8">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2"><Camera size={16} className="text-blue-500" /> 현장 사진</h4>
                  <div className="flex overflow-x-auto gap-3 pb-2 snap-x">
                    {currentEntry.images.map((imgUrl, idx) => (
                      <img key={idx} src={imgUrl} alt="현장사진" onClick={() => setExpandedImage(imgUrl)} className="h-48 w-48 object-cover rounded-xl shadow-sm snap-center shrink-0 border border-gray-200 cursor-pointer" />
                    ))}
                  </div>
                </div>
              )}
              <div className="space-y-4">
                {currentEntry.memo?.transport && <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100"><div className="flex items-center gap-2 text-blue-700 font-semibold mb-2 text-sm"><Train size={16} /> 교통 및 접근성</div><p className="text-gray-700 text-sm whitespace-pre-wrap">{currentEntry.memo.transport}</p></div>}
                {currentEntry.memo?.condition && <div className="bg-emerald-50/50 p-4 rounded-xl border border-emerald-100"><div className="flex items-center gap-2 text-emerald-700 font-semibold mb-2 text-sm"><Building size={16} /> 단지 상태 및 연식</div><p className="text-gray-700 text-sm whitespace-pre-wrap">{currentEntry.memo.condition}</p></div>}
                {currentEntry.memo?.surroundings && <div className="bg-amber-50/50 p-4 rounded-xl border border-amber-100"><div className="flex items-center gap-2 text-amber-700 font-semibold mb-2 text-sm"><Coffee size={16} /> 주변 환경 및 상권</div><p className="text-gray-700 text-sm whitespace-pre-wrap">{currentEntry.memo.surroundings}</p></div>}
                {currentEntry.memo?.vibe && <div className="bg-purple-50/50 p-4 rounded-xl border border-purple-100"><div className="flex items-center gap-2 text-purple-700 font-semibold mb-2 text-sm"><MessageCircle size={16} /> 분위기 및 기타</div><p className="text-gray-700 text-sm whitespace-pre-wrap">{currentEntry.memo.vibe}</p></div>}
              </div>
            </div>
          )}

          {/* 🏠 매물 관리 탭 */}
          {detailTab === 'props' && (
            <div className="animate-in fade-in duration-300">
              <div className="flex justify-between items-center mb-4">
                <h4 className="text-sm font-semibold text-gray-700">등록된 매물 <span className="text-indigo-600">{properties.length}</span>건</h4>
                <button onClick={() => { resetPropForm(); setIsPropFormOpen(true); }} className="flex items-center gap-1 bg-indigo-600 text-white px-3 py-1.5 rounded-full text-xs font-bold hover:bg-indigo-700"><Plus size={14}/> 매물 추가</button>
              </div>

              {isPropFormOpen && (
                <div className="bg-indigo-50/50 border border-indigo-100 p-4 rounded-xl mb-6 space-y-4">
                  <div className="flex justify-between items-center border-b border-indigo-100 pb-2 mb-2">
                    <span className="font-bold text-indigo-800 text-sm">{propEditId ? '매물 수정' : '새 매물 입력'}</span>
                    <button onClick={resetPropForm} className="text-gray-400 hover:text-gray-600"><X size={16}/></button>
                  </div>
                  <div><label className="text-xs font-semibold text-gray-600">가격 (매매/전세 등)</label><input type="text" value={propPrice} onChange={e=>setPropPrice(e.target.value)} placeholder="예: 매매 8.5억" className="w-full mt-1 p-2.5 rounded-lg border border-gray-200 text-sm"/></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="text-xs font-semibold text-gray-600">면적/평형</label><input type="text" value={propArea} onChange={e=>setPropArea(e.target.value)} placeholder="예: 84㎡ (34평)" className="w-full mt-1 p-2.5 rounded-lg border border-gray-200 text-sm"/></div>
                    <div><label className="text-xs font-semibold text-gray-600">유형 (계단/복도)</label><select value={propType} onChange={e=>setPropType(e.target.value)} className="w-full mt-1 p-2.5 rounded-lg border border-gray-200 text-sm bg-white"><option>계단식</option><option>복도식</option><option>복층형</option><option>기타</option></select></div>
                    <div><label className="text-xs font-semibold text-gray-600">방/화장실</label><div className="flex gap-1 mt-1"><input type="number" value={propRooms} onChange={e=>setPropRooms(e.target.value)} placeholder="방" className="w-full p-2.5 rounded-lg border border-gray-200 text-sm"/><input type="number" value={propBaths} onChange={e=>setPropBaths(e.target.value)} placeholder="화" className="w-full p-2.5 rounded-lg border border-gray-200 text-sm"/></div></div>
                    <div><label className="text-xs font-semibold text-gray-600">층수/방향</label><input type="text" value={propFloor} onChange={e=>setPropFloor(e.target.value)} placeholder="예: 12층 남향" className="w-full mt-1 p-2.5 rounded-lg border border-gray-200 text-sm"/></div>
                  </div>
                  <div><label className="text-xs font-semibold text-gray-600">특이사항</label><textarea value={propNotes} onChange={e=>setPropNotes(e.target.value)} placeholder="올수리, 세입자 안고, 누수 흔적 등" className="w-full mt-1 p-2.5 rounded-lg border border-gray-200 text-sm h-20 resize-none"/></div>
                  <button onClick={handleSaveProperty} className="w-full bg-indigo-600 text-white font-bold py-3 rounded-lg hover:bg-indigo-700">저장하기</button>
                </div>
              )}

              <div className="space-y-4">
                {properties.map(prop => (
                  <div key={prop.id} className="bg-white border border-gray-200 p-4 rounded-xl shadow-sm relative group">
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-lg font-extrabold text-gray-900">{prop.price}</span>
                      <div className="flex gap-2">
                        <button onClick={() => openEditProperty(prop)} className="text-gray-400 hover:text-indigo-500"><Edit size={16}/></button>
                        <button onClick={() => handleDeleteProperty(prop.id)} className="text-gray-400 hover:text-red-500"><Trash2 size={16}/></button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {prop.area && <span className="bg-gray-100 text-gray-700 text-[11px] px-2 py-1 rounded font-medium flex items-center gap-1"><Maximize size={10}/> {prop.area}</span>}
                      {prop.type && <span className="bg-gray-100 text-gray-700 text-[11px] px-2 py-1 rounded font-medium">{prop.type}</span>}
                      {(prop.rooms || prop.baths) && <span className="bg-indigo-50 text-indigo-700 text-[11px] px-2 py-1 rounded font-medium flex items-center gap-1">방 {prop.rooms||0} / 화 {prop.baths||0}</span>}
                      {prop.floor && <span className="bg-gray-100 text-gray-700 text-[11px] px-2 py-1 rounded font-medium flex items-center gap-1"><Building size={10}/> {prop.floor}</span>}
                    </div>
                    {prop.notes && <div className="bg-gray-50 p-3 rounded-lg text-sm text-gray-600 whitespace-pre-wrap"><FileText size={14} className="inline mr-1 text-gray-400 -mt-0.5"/>{prop.notes}</div>}
                    <div className="text-[10px] text-gray-400 mt-2 text-right">업데이트: {prop.updatedAt}</div>
                  </div>
                ))}
                {properties.length === 0 && !isPropFormOpen && <div className="text-center py-10 text-gray-400 text-sm">등록된 매물이 없습니다.</div>}
              </div>
            </div>
          )}

          {/* 🗺️ 입지 분석 탭 */}
          {detailTab === 'analysis' && (
            <div className="animate-in fade-in duration-300">
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs text-gray-500 flex items-center gap-1">
                  <Clock size={12}/> {analysisData?.lastUpdated ? `최근 업데이트: ${analysisData.lastUpdated}` : '업데이트 내역 없음'}
                </span>
                <button onClick={updateApiData} disabled={isPoiLoading} className="flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-full hover:bg-emerald-100 border border-emerald-200 disabled:opacity-50 transition-colors">
                  {isPoiLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} 최신 정보 불러오기
                </button>
              </div>

              {!analysisData ? (
                <div className="text-center py-12 bg-gray-50 rounded-xl border border-dashed border-gray-300">
                  <Navigation size={32} className="mx-auto text-gray-300 mb-3"/>
                  <p className="text-sm text-gray-500 font-medium">우측 상단의 업데이트 버튼을 눌러<br/>입지 분석 데이터를 불러오세요.</p>
                </div>
              ) : (
                <>
                  {analysisData.nearestSubway && (
                    <div className="mb-6">
                      <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-3"><Train size={16} className="text-emerald-600" /> 가장 가까운 지하철역</h4>
                      <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-xl flex items-center justify-between shadow-sm">
                        <div><span className="text-emerald-800 font-bold text-lg block mb-1">{analysisData.nearestSubway.name}</span><span className="text-emerald-600 text-xs">단지에서 직선 {analysisData.nearestSubway.distance}m</span></div>
                        <div className="text-right bg-white px-3 py-2 rounded-lg border border-emerald-100"><span className="text-gray-400 text-[10px] block mb-0.5">도보 소요시간</span><span className="text-emerald-700 font-bold text-base">약 {analysisData.nearestSubway.walkTime}분</span></div>
                      </div>
                    </div>
                  )}
                  
                  <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-3"><MapPin size={16} className="text-emerald-600" /> 주요 거점 접근성</h4>
                  <div className="bg-white border border-gray-200 p-1 rounded-xl shadow-sm">
                    {POI_LIST.map((poi, idx) => {
                      const res = analysisData.poiResults?.[poi.name];
                      return (
                        <div key={idx} className="flex flex-col border-b border-gray-50 last:border-0 p-3">
                          <div className="flex justify-between items-center mb-2">
                            <div className="flex items-center gap-2"><span className="text-sm font-bold text-gray-800">{poi.name}</span><span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-sm">{poi.category}</span></div>
                            {/* 🔴 길찾기 목적지 연결 수정 (이름 대신 주소를 사용) */}
                            <a href={`https://map.kakao.com/?sName=${encodeURIComponent(currentEntry.address)}&eName=${encodeURIComponent(poi.name)}`} target="_blank" rel="noopener noreferrer" className="text-[11px] text-gray-500 hover:text-emerald-600 underline underline-offset-2 flex items-center gap-1">대중교통 보기 <ChevronLeft size={10} className="rotate-180" /></a>
                          </div>
                          <div className="flex gap-3 text-xs mt-1">
                            <div className="flex-1 bg-gray-50 p-2.5 rounded-lg flex flex-col justify-center"><span className="text-gray-400 block mb-0.5">지도상 직선거리</span><span className="font-bold text-gray-700 text-sm">{res ? `${res.straightDist} km` : '-'}</span></div>
                            <div className="flex-1 bg-emerald-50/30 p-2.5 rounded-lg border border-emerald-50 flex flex-col justify-center"><span className="text-emerald-600 block mb-0.5">자차 (업데이트 기준)</span><span className="font-bold text-emerald-700 text-sm">{res && res.driveTime ? `${res.driveTime}분` : '-'}</span></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderAdd = () => (
    // ... 기존 renderAdd 유지 (동일)
    <div className="flex-1 overflow-y-auto bg-white flex flex-col h-full">
      <div className="sticky top-0 bg-white/90 backdrop-blur-md border-b border-gray-100 p-4 flex items-center z-10">
        <button onClick={goToList} className="p-2 -ml-2 text-gray-600 rounded-full hover:bg-gray-100"><ChevronLeft size={24} /></button>
        <h2 className="text-lg font-bold flex-1 text-center pr-8">{isEditMode ? '기록 수정하기' : '새 임장 기록'}</h2>
      </div>

      <div className="p-6 space-y-6 pb-24">
        <div className="bg-gray-50 p-5 rounded-2xl border border-gray-100 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">단지명 검색</label>
            <div className="flex gap-2">
              <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="예: 등촌우성" className="flex-1 p-3 bg-white border border-gray-200 rounded-xl outline-none" />
              <button onClick={handleSearch} disabled={isSearching} className="bg-[#FEE500] text-[#000000] px-4 rounded-xl font-bold flex items-center gap-2">{isSearching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} 주소검색</button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">도로명 주소</label>
            <input type="text" readOnly value={newAddress} className="w-full p-3 bg-gray-100 border border-gray-200 rounded-xl outline-none text-sm text-gray-600" placeholder="검색하면 자동 입력" />
          </div>
          <div className="flex gap-4">
            <div className="flex-1"><label className="block text-sm font-semibold text-gray-700 mb-2">시/도</label><input type="text" readOnly value={newRegion} className="w-full p-3 bg-gray-100 border border-gray-200 rounded-xl text-sm outline-none text-gray-600" placeholder="자동입력" /></div>
            <div className="flex-1"><label className="block text-sm font-semibold text-gray-700 mb-2">구/군</label><input type="text" readOnly value={newDistrict} className="w-full p-3 bg-gray-100 border border-gray-200 rounded-xl text-sm outline-none text-gray-600" placeholder="자동입력" /></div>
          </div>
          <div className="flex gap-4">
            <div className="flex-1"><label className="block text-sm font-semibold text-gray-700 mb-2">세대수</label><div className="relative"><input type="text" value={newHouseholds} onChange={(e) => setNewHouseholds(e.target.value)} placeholder="직접 입력" className="w-full p-3 bg-white border border-gray-200 rounded-xl text-sm pr-10 outline-none" /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">세대</span></div></div>
            <div className="flex-1"><label className="block text-sm font-semibold text-gray-700 mb-2">임장 날짜</label><input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="w-full p-3 bg-white border border-gray-200 rounded-xl text-sm outline-none" /></div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center justify-between"><span className="flex items-center gap-2"><Camera size={16} /> 현장 사진</span><span className="text-[10px] text-gray-400">자동 압축(1MB 이하)</span></label>
          <div className="flex flex-wrap gap-3">
            {existingImages.map((imgUrl, idx) => (
              <div key={`exist-${idx}`} className="relative w-20 h-20 opacity-90 border-2 border-blue-200 rounded-xl"><img src={imgUrl} className="w-full h-full object-cover rounded-xl" alt="기존"/><button onClick={() => removeExistingImage(idx)} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1"><Trash2 size={12} /></button></div>
            ))}
            {newImagePreviews.map((imgPreviewUrl, idx) => (
              <div key={`new-${idx}`} className="relative w-20 h-20"><img src={imgPreviewUrl} className="w-full h-full object-cover rounded-xl" alt="새사진"/><button onClick={() => removeNewImage(idx)} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1"><Trash2 size={12} /></button></div>
            ))}
            <button onClick={() => fileInputRef.current?.click()} className="w-20 h-20 flex flex-col items-center justify-center bg-gray-50 border-2 border-dashed border-gray-300 rounded-xl"><Plus size={20} /></button>
            <input type="file" multiple accept="image/*" className="hidden" ref={fileInputRef} onChange={handleImageChange} />
          </div>
        </div>

        <div className="space-y-4 pt-2">
          <label className="block text-sm font-semibold text-gray-700 border-b pb-2">상세 임장 메모</label>
          <div className="relative"><div className="absolute top-3 left-3 text-blue-500"><Train size={16} /></div><textarea value={memoTransport} onChange={(e) => setMemoTransport(e.target.value)} placeholder="교통 및 접근성 (역 도보 소요시간 등)" className="w-full p-3 pl-10 bg-gray-50 border border-gray-200 rounded-xl h-24 text-sm outline-none resize-none" /></div>
          <div className="relative"><div className="absolute top-3 left-3 text-emerald-500"><Home size={16} /></div><textarea value={memoCondition} onChange={(e) => setMemoCondition(e.target.value)} placeholder="단지 상태 및 연식 (동간거리, 관리상태 등)" className="w-full p-3 pl-10 bg-gray-50 border border-gray-200 rounded-xl h-24 text-sm outline-none resize-none" /></div>
          <div className="relative"><div className="absolute top-3 left-3 text-amber-500"><Coffee size={16} /></div><textarea value={memoSurroundings} onChange={(e) => setMemoSurroundings(e.target.value)} placeholder="주변 환경 및 상권" className="w-full p-3 pl-10 bg-gray-50 border border-gray-200 rounded-xl h-24 text-sm outline-none resize-none" /></div>
          <div className="relative"><div className="absolute top-3 left-3 text-purple-500"><MessageCircle size={16} /></div><textarea value={memoVibe} onChange={(e) => setMemoVibe(e.target.value)} placeholder="분위기 및 기타" className="w-full p-3 pl-10 bg-gray-50 border border-gray-200 rounded-xl h-24 text-sm outline-none resize-none" /></div>
        </div>

        <button onClick={handleSave} disabled={isSaving} className={`w-full text-white font-bold py-4 rounded-xl shadow-lg flex items-center justify-center gap-2 disabled:opacity-70 ${isEditMode ? 'bg-indigo-600' : 'bg-blue-600'}`}>
          {isSaving ? <><Loader2 size={20} className="animate-spin" /> 저장 중...</> : (isEditMode ? '수정한 내용 저장하기' : '새 기록 저장하기')}
        </button>
      </div>
    </div>
  );

  return (
    <div className="w-full max-w-md mx-auto h-[100dvh] flex flex-col bg-white overflow-hidden shadow-2xl relative border-x border-gray-100 font-sans">
      {currentView === 'list' && renderList()}
      {currentView === 'detail' && renderDetail()}
      {currentView === 'add' && renderAdd()}
      
      {expandedImage && (
        <div className="absolute inset-0 z-[100] bg-black/95 flex flex-col items-center justify-center" onClick={() => setExpandedImage(null)}>
          <button className="absolute top-6 right-6 text-white p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"><X size={24} /></button>
          <img src={expandedImage} className="max-w-full max-h-full object-contain select-none px-4" alt="확대" onClick={(e) => e.stopPropagation()} />
        </div>
      )}

      {currentView === 'list' && (
        <div className="absolute bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-6 py-4 flex justify-around items-center z-50">
          <button onClick={goToList} className="flex flex-col items-center gap-1 text-blue-600"><ListIcon size={24} /><span className="text-xs font-semibold">목록</span></button>
          <button onClick={goToAdd} className="flex flex-col items-center gap-1 group"><div className="bg-blue-600 text-white p-3 rounded-full -mt-8 shadow-lg"><Plus size={28} /></div><span className="text-xs font-semibold mt-1 text-gray-400">작성</span></button>
        </div>
      )}
    </div>
  );
}