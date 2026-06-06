import React, { useState, useRef, useMemo, useEffect } from 'react';
import { 
  MapPin, Camera, Calendar, ChevronLeft, Plus, List as ListIcon, 
  Trash2, Image as ImageIcon, Building, Search, Users, Map, 
  Train, Home, Coffee, MessageCircle, Loader2, Filter, Edit, Navigation, RefreshCw, X
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

// 직선거리 계산 함수 (단위: km)
const getStraightDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; 
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

// 네이티브 이미지 압축 함수
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
          if (width > maxWidthOrHeight) {
            height = Math.round((height *= maxWidthOrHeight / width));
            width = maxWidthOrHeight;
          }
        } else {
          if (height > maxWidthOrHeight) {
            width = Math.round((width *= maxWidthOrHeight / height));
            height = maxWidthOrHeight;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error('Canvas to Blob failed'));
            return;
          }
          const compressedFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".jpeg", {
            type: 'image/jpeg',
            lastModified: Date.now(),
          });
          resolve(compressedFile);
        }, 'image/jpeg', 0.8);
      };
      img.onerror = (error) => reject(error);
    };
    reader.onerror = (error) => reject(error);
  });
};

export default function App() {
  const [entries, setEntries] = useState([]);
  const [currentView, setCurrentView] = useState('list');
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // 탭 상태 변수 및 확대 이미지 상태
  const [detailTab, setDetailTab] = useState('memo'); 
  const [expandedImage, setExpandedImage] = useState(null); // 추가된 사진 확대 상태

  const [filterRegion, setFilterRegion] = useState('전체');
  const [filterDistrict, setFilterDistrict] = useState('전체');

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
  
  const [isSearching, setIsSearching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false); 
  const [editTargetId, setEditTargetId] = useState(null); 
  
  // 입지 분석 결과 상태
  const [poiResults, setPoiResults] = useState({}); 
  const [nearestSubway, setNearestSubway] = useState(null); // 가장 가까운 지하철역 상태
  const [isPoiLoading, setIsPoiLoading] = useState(false); 
  
  const fileInputRef = useRef(null);

  // 🔴 중요: 여기에 실제 카카오 REST API 키를 넣으세요!
  const KAKAO_REST_API_KEY = 'ec73b276eedaefb216ac1a88193e13c4';

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'imjang_notes'), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      data.sort((a, b) => {
        const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
        const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
        return timeB - timeA;
      });
      setEntries(data);
      setIsLoading(false);
    }, (error) => {
      console.error(error);
      setIsLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const availableRegions = ['전체', ...new Set(entries.map(e => e.region).filter(Boolean))];
  const availableDistricts = useMemo(() => {
    if (filterRegion === '전체') return ['전체'];
    const districts = entries.filter(e => e.region === filterRegion).map(e => e.district).filter(Boolean);
    return ['전체', ...new Set(districts)];
  }, [filterRegion, entries]);

  const filteredEntries = useMemo(() => {
    return entries.filter(entry => {
      if (filterRegion !== '전체' && entry.region !== filterRegion) return false;
      if (filterDistrict !== '전체' && entry.district !== filterDistrict) return false;
      return true;
    });
  }, [entries, filterRegion, filterDistrict]);

  const goToList = () => {
    setCurrentView('list');
    setSelectedEntry(null);
    setIsEditMode(false);
  };

  const goToDetail = (entry) => {
    setSelectedEntry(entry);
    setPoiResults({}); 
    setNearestSubway(null); // 상세페이지 열릴 때 지하철 결과 초기화
    setDetailTab('memo'); 
    setCurrentView('detail');
  };

  const goToAdd = () => {
    setNewName(''); setNewRegion(''); setNewDistrict(''); setNewAddress(''); setNewHouseholds('');
    setNewDate(new Date().toISOString().split('T')[0]);
    setMemoTransport(''); setMemoCondition(''); setMemoSurroundings(''); setMemoVibe('');
    setExistingImages([]); setNewImageFiles([]); setNewImagePreviews([]);
    setIsEditMode(false); setEditTargetId(null);
    setCurrentView('add');
  };

  const goToEdit = () => {
    setNewName(selectedEntry.name); setNewRegion(selectedEntry.region); setNewDistrict(selectedEntry.district);
    setNewAddress(selectedEntry.address || ''); setNewHouseholds(selectedEntry.households || '');
    setNewDate(selectedEntry.date || new Date().toISOString().split('T')[0]);
    setMemoTransport(selectedEntry.memo?.transport || ''); setMemoCondition(selectedEntry.memo?.condition || '');
    setMemoSurroundings(selectedEntry.memo?.surroundings || ''); setMemoVibe(selectedEntry.memo?.vibe || '');
    setExistingImages(selectedEntry.images || []); setNewImageFiles([]); setNewImagePreviews([]);
    setIsEditMode(true); setEditTargetId(selectedEntry.id);
    setCurrentView('add');
  };

  const handleImageChange = async (e) => {
    const files = Array.from(e.target.files);
    try {
      const compressedFiles = await Promise.all(files.map(file => compressImage(file, 1, 1920)));
      setNewImageFiles(prev => [...prev, ...compressedFiles]);
      const imageUrls = compressedFiles.map(file => URL.createObjectURL(file));
      setNewImagePreviews(prev => [...prev, ...imageUrls]);
    } catch (error) {
      alert('이미지 처리 중 오류가 발생했습니다.');
    }
  };

  const removeNewImage = (idx) => {
    setNewImageFiles(prev => prev.filter((_, i) => i !== idx));
    setNewImagePreviews(prev => prev.filter((_, i) => i !== idx));
  };
  const removeExistingImage = (idx) => setExistingImages(prev => prev.filter((_, i) => i !== idx));

  const calculateRoutes = async () => {
    if (KAKAO_REST_API_KEY === '실제_REST_API_키를_여기에_넣으세요' || !KAKAO_REST_API_KEY) {
      alert('코드 상단에 카카오 REST API 키를 먼저 입력해주세요!');
      return;
    }
    setIsPoiLoading(true);
    try {
      // 1. 단지 주소 좌표 검색
      const localRes = await fetch(`https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(selectedEntry.address)}`, {
        headers: { Authorization: `KakaoAK ${KAKAO_REST_API_KEY}` }
      });
      const localData = await localRes.json();
      
      if (!localData.documents || localData.documents.length === 0) {
        alert('단지 주소의 좌표를 찾을 수 없어 거리 계산이 불가능합니다.');
        setIsPoiLoading(false);
        return;
      }
      const originX = localData.documents[0].x;
      const originY = localData.documents[0].y;

      // 2. 가장 가까운 지하철역 검색 (카카오 카테고리 SW8)
      try {
        const subwayRes = await fetch(`https://dapi.kakao.com/v2/local/search/category.json?category_group_code=SW8&x=${originX}&y=${originY}&sort=distance`, {
          headers: { Authorization: `KakaoAK ${KAKAO_REST_API_KEY}` }
        });
        const subwayData = await subwayRes.json();
        if (subwayData.documents && subwayData.documents.length > 0) {
          const nearest = subwayData.documents[0];
          const distance = parseInt(nearest.distance, 10);
          const walkTime = Math.ceil(distance / 67); // 성인 도보 약 67m/분 기준 계산
          setNearestSubway({
            name: nearest.place_name,
            distance: distance,
            walkTime: walkTime
          });
        } else {
          setNearestSubway(null);
        }
      } catch(e) { console.error('지하철 API 오류:', e); }

      // 3. 주요 거점 데이터 계산
      const results = {};
      for (const poi of POI_LIST) {
        const stDist = getStraightDistance(originY, originX, poi.y, poi.x);
        let driveTime = null;

        try {
          const naviRes = await fetch(`https://apis-navi.kakaomobility.com/v1/directions?origin=${originX},${originY}&destination=${poi.x},${poi.y}`, {
            headers: { Authorization: `KakaoAK ${KAKAO_REST_API_KEY}` }
          });
          const naviData = await naviRes.json();
          if (naviData.routes && naviData.routes.length > 0) {
            driveTime = Math.ceil(naviData.routes[0].summary.duration / 60); 
          }
        } catch(e) { console.error('내비게이션 API 연동 오류:', e); }

        results[poi.name] = { straightDist: stDist.toFixed(1), driveTime: driveTime };
      }
      setPoiResults(results); 
    } catch (error) {
      alert("실시간 정보를 불러오는데 실패했습니다.");
    } finally { setIsPoiLoading(false); }
  };

  const handleSearch = async () => {
    if (!newName.trim()) { alert('단지명을 입력해주세요.'); return; }
    if (KAKAO_REST_API_KEY === '실제_REST_API_키를_여기에_넣으세요' || !KAKAO_REST_API_KEY) {
      alert('코드 상단에 카카오 REST API 키를 먼저 입력해주세요!');
      return;
    }

    setIsSearching(true);
    try {
      const response = await fetch(`https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(newName)}`, {
        headers: { Authorization: `KakaoAK ${KAKAO_REST_API_KEY}` }
      });
      const data = await response.json();

      if (data.documents && data.documents.length > 0) {
        const place = data.documents[0];
        setNewAddress(place.road_address_name || place.address_name);
        const addressParts = place.address_name.split(' ');
        if (addressParts.length >= 2) {
          setNewRegion(addressParts[0]); setNewDistrict(addressParts[1]); 
        }
        alert('주소 검색 성공! 세대수는 직접 입력해주세요.');
      } else {
        alert('검색 결과가 없습니다. 단지명을 정확히 입력해주세요.');
      }
    } catch (error) { alert('주소 검색 중 오류가 발생했습니다.'); } finally { setIsSearching(false); }
  };

  const handleSave = async () => {
    if (!newName.trim() || !newRegion) { alert('단지명과 주소를 확인해주세요.'); return; }
    setIsSaving(true);
    try {
      const uploadedImageUrls = [];
      for (const file of newImageFiles) {
        const fileRef = ref(storage, `imjang_photos/${Date.now()}_${file.name}`);
        await uploadBytes(fileRef, file);
        const downloadUrl = await getDownloadURL(fileRef);
        uploadedImageUrls.push(downloadUrl);
      }
      const finalImages = [...existingImages, ...uploadedImageUrls];
      const entryData = {
        name: newName, region: newRegion, district: newDistrict, address: newAddress, households: newHouseholds, date: newDate,
        memo: { transport: memoTransport, condition: memoCondition, surroundings: memoSurroundings, vibe: memoVibe },
        images: finalImages
      };

      if (isEditMode) {
        await updateDoc(doc(db, 'imjang_notes', editTargetId), entryData);
      } else {
        entryData.createdAt = serverTimestamp();
        await addDoc(collection(db, 'imjang_notes'), entryData);
      }
      goToList();
    } catch (error) { alert('저장에 실패했습니다.'); } finally { setIsSaving(false); }
  };

  const handleDelete = async (id) => {
    if (window.confirm('이 기록을 삭제하시겠습니까? (삭제된 기록은 복구할 수 없습니다)')) {
      try {
        await deleteDoc(doc(db, 'imjang_notes', id));
        goToList();
      } catch (error) { alert('삭제에 실패했습니다.'); }
    }
  };

  const renderList = () => (
    <div className="flex-1 overflow-y-auto bg-gray-50 flex flex-col">
      <div className="bg-white px-5 pt-6 pb-4 border-b border-gray-100 sticky top-0 z-10">
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2 mb-4">
          <Building className="text-blue-600" size={24} /> 우리의 임장 노트 👩‍❤️‍👨
        </h2>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Filter size={16} className="text-gray-400" />
            <span className="text-xs font-semibold text-gray-500">지역 선택</span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {availableRegions.map(region => (
              <button key={region} onClick={() => { setFilterRegion(region); setFilterDistrict('전체'); }}
                className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${filterRegion === region ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >{region}</button>
            ))}
          </div>
          {filterRegion !== '전체' && (
            <div className="flex gap-2 overflow-x-auto pb-1 pt-1 scrollbar-hide">
              {availableDistricts.map(district => (
                <button key={district} onClick={() => setFilterDistrict(district)}
                  className={`px-3 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${filterDistrict === district ? 'bg-gray-800 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}
                >{district}</button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="p-4 space-y-4 pb-24 flex-1">
        <div className="text-sm font-medium text-gray-500 mb-2">검색 결과 <span className="text-blue-600">{filteredEntries.length}</span>건</div>
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 text-blue-500"><Loader2 size={40} className="animate-spin mb-4" /><p>데이터 불러오는 중...</p></div>
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
                  {entry.households && <span className="inline-flex items-center gap-1 text-xs text-gray-600 bg-gray-50 px-2 py-1 rounded-md"><Users size={12} /> {entry.households}세대</span>}
                  {entry.images && entry.images.length > 0 && <span className="inline-flex items-center gap-1 text-xs text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md"><ImageIcon size={12} /> {entry.images.length}장</span>}
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
    if (!selectedEntry) return null;
    return (
      <div className="flex-1 overflow-y-auto bg-white flex flex-col h-full relative">
        {/* 상단 네비게이션 */}
        <div className="sticky top-0 bg-white/90 backdrop-blur-md border-b border-gray-100 p-4 flex items-center justify-between z-20">
          <button onClick={goToList} className="p-2 -ml-2 text-gray-600 rounded-full hover:bg-gray-100"><ChevronLeft size={24} /></button>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold px-2 py-1 bg-blue-50 text-blue-600 rounded-md">{selectedEntry.region}</span>
            <span className="text-xs font-bold px-2 py-1 bg-gray-100 text-gray-600 rounded-md">{selectedEntry.district}</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={goToEdit} className="text-blue-500 p-2 rounded-full hover:bg-blue-50"><Edit size={20} /></button>
            <button onClick={() => handleDelete(selectedEntry.id)} className="text-red-500 p-2 rounded-full hover:bg-red-50"><Trash2 size={20} /></button>
          </div>
        </div>

        <div className="p-6 pb-20">
          {/* 단지 기본 정보 */}
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900 mb-3">{selectedEntry.name}</h1>
            <div className="flex flex-col gap-2 text-sm text-gray-600 bg-gray-50 p-4 rounded-xl">
              {selectedEntry.address && <span className="flex items-center gap-2"><Map size={16} className="text-blue-500"/> {selectedEntry.address}</span>}
              <div className="flex gap-4 mt-1">
                {selectedEntry.households && <span className="flex items-center gap-2"><Users size={16} className="text-blue-500"/> {selectedEntry.households}세대</span>}
                <span className="flex items-center gap-2"><Calendar size={16} className="text-blue-500"/> {selectedEntry.date}</span>
              </div>
            </div>
          </div>

          {/* 탭 메뉴 */}
          <div className="flex border-b border-gray-200 mb-6">
            <button
              onClick={() => setDetailTab('memo')}
              className={`flex-1 py-3 text-sm font-bold flex justify-center items-center gap-2 border-b-2 transition-all ${
                detailTab === 'memo' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              <MessageCircle size={16} /> 임장 메모
            </button>
            <button
              onClick={() => setDetailTab('analysis')}
              className={`flex-1 py-3 text-sm font-bold flex justify-center items-center gap-2 border-b-2 transition-all ${
                detailTab === 'analysis' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              <Navigation size={16} /> 입지 분석
            </button>
          </div>

          {/* 탭 내용 분기 */}
          {detailTab === 'memo' ? (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
              {selectedEntry.images && selectedEntry.images.length > 0 && (
                <div className="mb-8">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2"><Camera size={16} className="text-blue-500" /> 현장 사진</h4>
                  <div className="flex overflow-x-auto gap-3 pb-2 snap-x">
                    {selectedEntry.images.map((imgUrl, idx) => (
                      <img 
                        key={idx} 
                        src={imgUrl} 
                        alt="현장사진" 
                        onClick={() => setExpandedImage(imgUrl)} // 사진 클릭 시 확대되도록 이벤트 추가
                        className="h-48 w-48 object-cover rounded-xl shadow-sm snap-center shrink-0 border border-gray-200 cursor-pointer hover:opacity-90 transition-opacity"
                      />
                    ))}
                  </div>
                  <p className="text-[10px] text-gray-400 mt-2 text-center">사진을 탭하면 크게 볼 수 있습니다.</p>
                </div>
              )}

              <div className="space-y-4">
                {selectedEntry.memo?.transport && <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100"><div className="flex items-center gap-2 text-blue-700 font-semibold mb-2 text-sm"><Train size={16} /> 교통 및 접근성</div><p className="text-gray-700 whitespace-pre-wrap text-sm leading-relaxed">{selectedEntry.memo.transport}</p></div>}
                {selectedEntry.memo?.condition && <div className="bg-emerald-50/50 p-4 rounded-xl border border-emerald-100"><div className="flex items-center gap-2 text-emerald-700 font-semibold mb-2 text-sm"><Home size={16} /> 단지 상태 및 연식</div><p className="text-gray-700 whitespace-pre-wrap text-sm leading-relaxed">{selectedEntry.memo.condition}</p></div>}
                {selectedEntry.memo?.surroundings && <div className="bg-amber-50/50 p-4 rounded-xl border border-amber-100"><div className="flex items-center gap-2 text-amber-700 font-semibold mb-2 text-sm"><Coffee size={16} /> 주변 환경 및 상권</div><p className="text-gray-700 whitespace-pre-wrap text-sm leading-relaxed">{selectedEntry.memo.surroundings}</p></div>}
                {selectedEntry.memo?.vibe && <div className="bg-purple-50/50 p-4 rounded-xl border border-purple-100"><div className="flex items-center gap-2 text-purple-700 font-semibold mb-2 text-sm"><MessageCircle size={16} /> 분위기 및 기타</div><p className="text-gray-700 whitespace-pre-wrap text-sm leading-relaxed">{selectedEntry.memo.vibe}</p></div>}
                
                {(!selectedEntry.memo?.transport && !selectedEntry.memo?.condition && !selectedEntry.memo?.surroundings && !selectedEntry.memo?.vibe) && (
                  <p className="text-center text-gray-400 py-10 text-sm">작성된 상세 메모가 없습니다.</p>
                )}
              </div>
            </div>
          ) : (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex items-center justify-end mb-4">
                <button 
                  onClick={calculateRoutes} 
                  disabled={isPoiLoading}
                  className="flex items-center gap-1 text-[11px] font-bold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-full hover:bg-blue-100 disabled:opacity-50 transition-colors shadow-sm"
                >
                  {isPoiLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                  API 실시간 업데이트
                </button>
              </div>

              {/* 지하철역 최우선 표시 영역 */}
              {nearestSubway && (
                <div className="mb-6">
                  <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-3">
                    <Train size={16} className="text-blue-500" /> 가장 가까운 지하철역
                  </h4>
                  <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-xl flex items-center justify-between shadow-sm">
                    <div>
                      <span className="text-emerald-700 font-bold text-lg block leading-tight mb-1">{nearestSubway.name}</span>
                      <span className="text-emerald-600/80 text-xs">단지에서 직선 {nearestSubway.distance}m</span>
                    </div>
                    <div className="text-right bg-white px-3 py-2 rounded-lg border border-emerald-100">
                      <span className="text-gray-400 text-[10px] block mb-0.5">도보 소요시간</span>
                      <span className="text-emerald-700 font-bold text-base">약 {nearestSubway.walkTime}분</span>
                    </div>
                  </div>
                </div>
              )}
              
              <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-3">
                <MapPin size={16} className="text-blue-500" /> 주요 거점 접근성
              </h4>
              <div className="bg-white border border-gray-200 p-1 rounded-xl shadow-sm">
                {POI_LIST.map((poi, idx) => {
                  const res = poiResults[poi.name];
                  return (
                    <div key={idx} className="flex flex-col border-b border-gray-50 last:border-0 p-3">
                      <div className="flex justify-between items-center mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-gray-800">{poi.name}</span>
                          <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-sm">{poi.category}</span>
                        </div>
                        <a 
                          href={`https://map.kakao.com/?sName=${encodeURIComponent(selectedEntry.address || selectedEntry.name)}&eName=${encodeURIComponent(poi.name)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-gray-500 hover:text-blue-600 underline underline-offset-2 flex items-center gap-1"
                        >
                          대중교통 보기 <ChevronLeft size={10} className="rotate-180" />
                        </a>
                      </div>
                      
                      <div className="flex gap-3 text-xs mt-1">
                        <div className="flex-1 bg-gray-50 p-2.5 rounded-lg flex flex-col justify-center">
                          <span className="text-gray-400 block mb-0.5">지도상 직선거리</span>
                          <span className="font-bold text-gray-700 text-sm">
                            {res ? `${res.straightDist} km` : '-'}
                          </span>
                        </div>
                        <div className="flex-1 bg-blue-50/50 p-2.5 rounded-lg border border-blue-50 flex flex-col justify-center">
                          <span className="text-blue-400 block mb-0.5">자차 소요 (현재기준)</span>
                          <span className="font-bold text-blue-700 text-sm">
                            {res && res.driveTime ? `${res.driveTime}분` : '-'}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] text-gray-400 mt-3 text-center leading-relaxed">
                * 직선거리는 카카오 API 좌표 기반 자체 계산입니다.<br/>
                * 자차/도보 시간은 클릭 시점의 실시간 카카오 API 기준입니다.<br/>
                * 대중교통은 카카오 정책상 외부 앱 링크로 확인 가능합니다.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderAdd = () => (
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
      
      {/* 💡 전체화면 사진 확대 모달 */}
      {expandedImage && (
        <div 
          className="absolute inset-0 z-[100] bg-black/95 flex flex-col items-center justify-center"
          onClick={() => setExpandedImage(null)}
        >
          <button 
            className="absolute top-6 right-6 text-white p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              setExpandedImage(null);
            }}
          >
            <X size={24} />
          </button>
          <img 
            src={expandedImage} 
            className="max-w-full max-h-full object-contain select-none px-4" 
            alt="확대 사진" 
            onClick={(e) => e.stopPropagation()} // 클릭 시 닫히지 않도록 막음
          />
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