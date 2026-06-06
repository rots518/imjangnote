import React, { useState, useRef, useMemo, useEffect } from 'react';
import { 
  MapPin, Camera, Calendar, ChevronLeft, Plus, List as ListIcon, 
  Trash2, Image as ImageIcon, Building, Search, Users, Map, 
  Train, Home, Coffee, MessageCircle, Loader2, Filter
} from 'lucide-react';

// === Firebase SDK 초기화 부분 ===
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, onSnapshot, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
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

export default function App() {
  const [entries, setEntries] = useState([]);
  const [currentView, setCurrentView] = useState('list');
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // 카테고리 필터 상태
  const [filterRegion, setFilterRegion] = useState('전체');
  const [filterDistrict, setFilterDistrict] = useState('전체');

  // 새 글 작성 상태
  const [newName, setNewName] = useState('');
  const [newRegion, setNewRegion] = useState('');
  const [newDistrict, setNewDistrict] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newHouseholds, setNewHouseholds] = useState('');
  const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0]);
  
  // 세분화된 메모 상태
  const [memoTransport, setMemoTransport] = useState('');
  const [memoCondition, setMemoCondition] = useState('');
  const [memoSurroundings, setMemoSurroundings] = useState('');
  const [memoVibe, setMemoVibe] = useState('');
  
  // 사진 업로드 관련 상태
  const [newImageFiles, setNewImageFiles] = useState([]); // 실제 업로드될 파일
  const [newImagePreviews, setNewImagePreviews] = useState([]); // 화면에 보여줄 미리보기 URL
  
  const [isSearching, setIsSearching] = useState(false);
  const [isSaving, setIsSaving] = useState(false); // 저장 중 로딩 상태
  const fileInputRef = useRef(null);

  // === 실시간 데이터 동기화 (Firebase Firestore) ===
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'imjang_notes'), (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      // 최신순으로 메모리 내 정렬
      data.sort((a, b) => {
        const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
        const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
        return timeB - timeA;
      });

      setEntries(data);
      setIsLoading(false);
    }, (error) => {
      console.error("데이터를 불러오는 중 에러 발생:", error);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // 고유 지역(시/도) 및 세부 지역(구/군) 추출
  const availableRegions = ['전체', ...new Set(entries.map(e => e.region).filter(Boolean))];
  const availableDistricts = useMemo(() => {
    if (filterRegion === '전체') return ['전체'];
    const districts = entries.filter(e => e.region === filterRegion).map(e => e.district).filter(Boolean);
    return ['전체', ...new Set(districts)];
  }, [filterRegion, entries]);

  // 목록 필터링
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
  };

  const goToDetail = (entry) => {
    setSelectedEntry(entry);
    setCurrentView('detail');
  };

  const goToAdd = () => {
    setNewName('');
    setNewRegion('');
    setNewDistrict('');
    setNewAddress('');
    setNewHouseholds('');
    setNewDate(new Date().toISOString().split('T')[0]);
    setMemoTransport('');
    setMemoCondition('');
    setMemoSurroundings('');
    setMemoVibe('');
    setNewImageFiles([]);
    setNewImagePreviews([]);
    setCurrentView('add');
  };

  // 사진 첨부 핸들러
  const handleImageChange = (e) => {
    const files = Array.from(e.target.files);
    setNewImageFiles(prev => [...prev, ...files]);
    
    const imageUrls = files.map(file => URL.createObjectURL(file));
    setNewImagePreviews(prev => [...prev, ...imageUrls]);
  };

  const removeImage = (idx) => {
    setNewImageFiles(prev => prev.filter((_, i) => i !== idx));
    setNewImagePreviews(prev => prev.filter((_, i) => i !== idx));
  };

  // 단지명 검색 (카카오맵 API 연동)
  const handleSearch = async () => {
    if (!newName.trim()) {
      alert('단지명을 입력해주세요.');
      return;
    }
    
    // 👇 이곳에 카카오 디벨로퍼스에서 발급받은 REST API 키를 넣으세요!
    const KAKAO_REST_API_KEY = 'ec73b276eedaefb216ac1a88193e13c4';
    
    if (KAKAO_REST_API_KEY === '실제_카카오_REST_API_키를_여기에_넣으세요' || KAKAO_REST_API_KEY === 'API_KEY') {
      alert('코드에 카카오 REST API 키를 먼저 입력해주세요!');
      return;
    }

    setIsSearching(true);
    
    try {
      // 카카오 키워드 장소 검색 API 호출
      const response = await fetch(`https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(newName)}`, {
        headers: {
          Authorization: `KakaoAK ${KAKAO_RESTAPI_KEY}`
        }
      });

      if (!response.ok) throw new Error('API 네트워크 에러');

      const data = await response.json();

      if (data.documents && data.documents.length > 0) {
        // 검색된 결과 중 가장 관련성 높은 첫 번째 결과 가져오기
        const place = data.documents[0];
        
        // 도로명 주소가 있으면 도로명, 없으면 지번 주소 사용
        const address = place.road_address_name || place.address_name;
        setNewAddress(address);

        // 지번 주소를 분리해서 시/도, 구/군 추출 (예: "서울 강서구 등촌동 123")
        const addressParts = place.address_name.split(' ');
        if (addressParts.length >= 2) {
          setNewRegion(addressParts[0]); // 시/도 (예: 서울)
          setNewDistrict(addressParts[1]); // 구/군 (예: 강서구)
        }

        alert('주소 검색 성공! 세대수는 직접 입력해주세요.');
      } else {
        alert('검색 결과가 없습니다. 단지명을 더 정확히(예: 등촌동 우성) 입력해주세요.');
      }
    } catch (error) {
      console.error("검색 실패:", error);
      alert('주소 검색 중 오류가 발생했습니다.');
    } finally {
      setIsSearching(false);
    }
  };

  // === Firebase에 저장 ===
  const handleSave = async () => {
    if (!newName.trim()) {
      alert('단지명을 입력해주세요.');
      return;
    }
    if (!newRegion) {
      alert('주소 검색을 완료하거나 지역을 입력해주세요.');
      return;
    }

    setIsSaving(true); // 로딩 스피너 표시

    try {
      // 1. Storage에 사진 먼저 업로드
      const uploadedImageUrls = [];
      for (const file of newImageFiles) {
        // 중복 방지를 위해 파일명에 현재 시간(Date.now) 추가
        const fileRef = ref(storage, `imjang_photos/${Date.now()}_${file.name}`);
        await uploadBytes(fileRef, file);
        const downloadUrl = await getDownloadURL(fileRef);
        uploadedImageUrls.push(downloadUrl);
      }

      // 2. Firestore에 데이터 + 업로드된 사진 URL 같이 저장
      await addDoc(collection(db, 'imjang_notes'), {
        name: newName,
        region: newRegion,
        district: newDistrict,
        address: newAddress,
        households: newHouseholds,
        date: newDate,
        memo: {
          transport: memoTransport,
          condition: memoCondition,
          surroundings: memoSurroundings,
          vibe: memoVibe
        },
        images: uploadedImageUrls,
        createdAt: serverTimestamp() // 서버 시간 기록
      });

      goToList();
    } catch (error) {
      console.error("저장 실패:", error);
      alert('저장에 실패했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setIsSaving(false);
    }
  };

  // === Firebase에서 삭제 ===
  const handleDelete = async (id) => {
    if (window.confirm('이 기록을 삭제하시겠습니까? (삭제된 기록은 복구할 수 없습니다)')) {
      try {
        await deleteDoc(doc(db, 'imjang_notes', id));
        goToList();
      } catch (error) {
        console.error("삭제 실패:", error);
        alert('삭제에 실패했습니다.');
      }
    }
  };

  // ================= 렌더링: 리스트 뷰 =================
  const renderList = () => (
    <div className="flex-1 overflow-y-auto bg-gray-50 flex flex-col">
      <div className="bg-white px-5 pt-6 pb-4 border-b border-gray-100 sticky top-0 z-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Building className="text-blue-600" size={24} />
            우리의 임장 노트 👩‍❤️‍👨
          </h2>
        </div>
        
        {/* 지역 필터 영역 */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Filter size={16} className="text-gray-400" />
            <span className="text-xs font-semibold text-gray-500">지역 선택</span>
          </div>
          
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {availableRegions.map(region => (
              <button
                key={region}
                onClick={() => {
                  setFilterRegion(region);
                  setFilterDistrict('전체');
                }}
                className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                  filterRegion === region 
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-200' 
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {region}
              </button>
            ))}
          </div>

          {filterRegion !== '전체' && (
            <div className="flex gap-2 overflow-x-auto pb-1 pt-1 scrollbar-hide">
              {availableDistricts.map(district => (
                <button
                  key={district}
                  onClick={() => setFilterDistrict(district)}
                  className={`px-3 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                    filterDistrict === district 
                      ? 'bg-gray-800 text-white' 
                      : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {district}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="p-4 space-y-4 pb-24 flex-1">
        <div className="text-sm font-medium text-gray-500 mb-2">
          검색 결과 <span className="text-blue-600">{filteredEntries.length}</span>건
        </div>
        
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 text-blue-500">
            <Loader2 size={40} className="animate-spin mb-4" />
            <p className="text-gray-500 font-medium">데이터를 불러오는 중입니다...</p>
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="text-center py-20">
            <Map className="mx-auto text-gray-300 mb-3" size={48} />
            <p className="text-gray-500 font-medium">아직 등록된 임장 기록이 없습니다.</p>
          </div>
        ) : (
          filteredEntries.map(entry => (
            <div 
              key={entry.id} 
              onClick={() => goToDetail(entry)}
              className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 cursor-pointer active:scale-[0.98] transition-transform"
            >
              <div className="flex justify-between items-start mb-2">
                <div className="flex flex-col gap-1">
                  <div className="flex gap-1.5 mb-1">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-sm bg-blue-50 text-blue-600">{entry.region}</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-sm bg-gray-100 text-gray-600">{entry.district}</span>
                  </div>
                  <h3 className="text-lg font-bold text-gray-900 leading-tight">{entry.name}</h3>
                  {entry.address && (
                    <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                      <MapPin size={12} /> {entry.address}
                    </p>
                  )}
                </div>
              </div>
              
              <div className="flex gap-3 mt-4 items-center justify-between">
                <div className="flex gap-2">
                  {entry.households && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-600 bg-gray-50 px-2 py-1 rounded-md border border-gray-100">
                      <Users size={12} />
                      {entry.households}세대
                    </span>
                  )}
                  {entry.images && entry.images.length > 0 && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md border border-emerald-100">
                      <ImageIcon size={12} />
                      {entry.images.length}장
                    </span>
                  )}
                </div>
                <span className="text-[11px] font-medium text-gray-400">
                  {entry.date}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );

  // ================= 렌더링: 상세 뷰 =================
  const renderDetail = () => {
    if (!selectedEntry) return null;
    return (
      <div className="flex-1 overflow-y-auto bg-white flex flex-col h-full">
        <div className="sticky top-0 bg-white/90 backdrop-blur-md border-b border-gray-100 p-4 flex items-center justify-between z-10">
          <button onClick={goToList} className="p-2 -ml-2 text-gray-600 rounded-full hover:bg-gray-100">
            <ChevronLeft size={24} />
          </button>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold px-2 py-1 rounded-md bg-blue-50 text-blue-600">{selectedEntry.region}</span>
            <span className="text-xs font-bold px-2 py-1 rounded-md bg-gray-100 text-gray-600">{selectedEntry.district}</span>
          </div>
          <button onClick={() => handleDelete(selectedEntry.id)} className="text-red-500 p-2 rounded-full hover:bg-red-50">
            <Trash2 size={20} />
          </button>
        </div>

        <div className="p-6">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900 mb-3">{selectedEntry.name}</h1>
            <div className="flex flex-col gap-2 text-sm text-gray-600 bg-gray-50 p-4 rounded-xl">
              {selectedEntry.address && (
                <span className="flex items-center gap-2"><Map size={16} className="text-blue-500"/> {selectedEntry.address}</span>
              )}
              <div className="flex gap-4 mt-1">
                {selectedEntry.households && (
                  <span className="flex items-center gap-2"><Users size={16} className="text-blue-500"/> {selectedEntry.households}세대</span>
                )}
                <span className="flex items-center gap-2"><Calendar size={16} className="text-blue-500"/> {selectedEntry.date}</span>
              </div>
            </div>
          </div>

          {selectedEntry.images && selectedEntry.images.length > 0 && (
            <div className="mb-8">
              <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <Camera size={16} className="text-blue-500" /> 현장 사진
              </h4>
              <div className="flex overflow-x-auto gap-3 pb-2 snap-x">
                {selectedEntry.images.map((imgUrl, idx) => (
                  <img 
                    key={idx} 
                    src={imgUrl} 
                    alt={`현장 사진 ${idx + 1}`} 
                    className="h-48 w-48 object-cover rounded-xl shadow-sm snap-center shrink-0 border border-gray-200"
                  />
                ))}
              </div>
            </div>
          )}

          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-gray-700 mb-2 border-b pb-2 flex items-center gap-2">
              <MapPin size={16} className="text-blue-500"/> 상세 메모
            </h4>
            
            {selectedEntry.memo?.transport && (
              <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100">
                <div className="flex items-center gap-2 text-blue-700 font-semibold mb-2 text-sm">
                  <Train size={16} /> 교통 및 접근성
                </div>
                <p className="text-gray-700 whitespace-pre-wrap text-sm leading-relaxed">{selectedEntry.memo.transport}</p>
              </div>
            )}

            {selectedEntry.memo?.condition && (
              <div className="bg-emerald-50/50 p-4 rounded-xl border border-emerald-100">
                <div className="flex items-center gap-2 text-emerald-700 font-semibold mb-2 text-sm">
                  <Home size={16} /> 단지 상태 및 연식
                </div>
                <p className="text-gray-700 whitespace-pre-wrap text-sm leading-relaxed">{selectedEntry.memo.condition}</p>
              </div>
            )}

            {selectedEntry.memo?.surroundings && (
              <div className="bg-amber-50/50 p-4 rounded-xl border border-amber-100">
                <div className="flex items-center gap-2 text-amber-700 font-semibold mb-2 text-sm">
                  <Coffee size={16} /> 주변 환경 및 상권
                </div>
                <p className="text-gray-700 whitespace-pre-wrap text-sm leading-relaxed">{selectedEntry.memo.surroundings}</p>
              </div>
            )}

            {selectedEntry.memo?.vibe && (
              <div className="bg-purple-50/50 p-4 rounded-xl border border-purple-100">
                <div className="flex items-center gap-2 text-purple-700 font-semibold mb-2 text-sm">
                  <MessageCircle size={16} /> 분위기 및 기타
                </div>
                <p className="text-gray-700 whitespace-pre-wrap text-sm leading-relaxed">{selectedEntry.memo.vibe}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ================= 렌더링: 작성 뷰 =================
  const renderAdd = () => (
    <div className="flex-1 overflow-y-auto bg-white flex flex-col h-full">
      <div className="sticky top-0 bg-white/90 backdrop-blur-md border-b border-gray-100 p-4 flex items-center z-10">
        <button onClick={goToList} className="p-2 -ml-2 text-gray-600 rounded-full hover:bg-gray-100">
          <ChevronLeft size={24} />
        </button>
        <h2 className="text-lg font-bold flex-1 text-center pr-8">새 임장 기록</h2>
      </div>

      <div className="p-6 space-y-6 pb-24">
        {/* 단지 검색 및 기본 정보 영역 */}
        <div className="bg-gray-50 p-5 rounded-2xl border border-gray-100 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">단지명 검색</label>
            <div className="flex gap-2">
              <input 
                type="text" 
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="예: 등촌우성"
                className="flex-1 p-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
              />
              <button 
                onClick={handleSearch}
                disabled={isSearching}
                className="bg-[#FEE500] text-[#000000] px-4 rounded-xl font-bold hover:bg-[#FADA0A] flex items-center gap-2 disabled:opacity-50 text-sm shadow-sm"
              >
                {isSearching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                주소검색
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">도로명 주소</label>
            <input 
              type="text" 
              readOnly
              value={newAddress}
              placeholder="검색하면 자동으로 입력됩니다."
              className="w-full p-3 bg-gray-100 border border-gray-200 rounded-xl outline-none text-sm placeholder-gray-400 text-gray-600"
            />
          </div>
          
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-sm font-semibold text-gray-700 mb-2">시/도</label>
              <input type="text" readOnly value={newRegion} className="w-full p-3 bg-gray-100 border border-gray-200 rounded-xl outline-none text-sm text-gray-600" placeholder="자동입력" />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-semibold text-gray-700 mb-2">구/군</label>
              <input type="text" readOnly value={newDistrict} className="w-full p-3 bg-gray-100 border border-gray-200 rounded-xl outline-none text-sm text-gray-600" placeholder="자동입력" />
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-sm font-semibold text-gray-700 mb-2">세대수</label>
              <div className="relative">
                <input 
                  type="text" 
                  value={newHouseholds}
                  onChange={(e) => setNewHouseholds(e.target.value)}
                  placeholder="직접 입력"
                  className="w-full p-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm pr-10"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">세대</span>
              </div>
            </div>
            <div className="flex-1">
              <label className="block text-sm font-semibold text-gray-700 mb-2">임장 날짜</label>
              <input 
                type="date" 
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="w-full p-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
              />
            </div>
          </div>
        </div>

        {/* 사진 업로드 */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
            <Camera size={16} /> 현장 사진
          </label>
          <div className="flex flex-wrap gap-3">
            {newImagePreviews.map((imgPreviewUrl, idx) => (
              <div key={idx} className="relative w-20 h-20">
                <img src={imgPreviewUrl} className="w-full h-full object-cover rounded-xl border border-gray-200" alt="미리보기" />
                <button 
                  onClick={() => removeImage(idx)}
                  className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-md"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="w-20 h-20 flex flex-col items-center justify-center gap-1 bg-gray-50 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 hover:bg-gray-100 transition-colors"
            >
              <Plus size={20} />
            </button>
            <input 
              type="file" 
              multiple 
              accept="image/*" 
              className="hidden" 
              ref={fileInputRef}
              onChange={handleImageChange}
            />
          </div>
        </div>

        {/* 상세 메모 영역 */}
        <div className="space-y-4 pt-2">
          <label className="block text-sm font-semibold text-gray-700 border-b pb-2">상세 임장 메모</label>
          
          <div className="relative">
            <div className="absolute top-3 left-3 text-blue-500"><Train size={16} /></div>
            <textarea 
              value={memoTransport}
              onChange={(e) => setMemoTransport(e.target.value)}
              placeholder="교통 및 접근성 (지하철역 도보 몇 분, 정문/후문 진입로 등)"
              className="w-full p-3 pl-10 bg-gray-50 border border-gray-200 rounded-xl h-24 resize-none focus:ring-2 focus:ring-blue-500 outline-none text-sm"
            />
          </div>

          <div className="relative">
            <div className="absolute top-3 left-3 text-emerald-500"><Home size={16} /></div>
            <textarea 
              value={memoCondition}
              onChange={(e) => setMemoCondition(e.target.value)}
              placeholder="단지 상태 및 연식 (동간 거리, 단지 내부 관리, 노후도 등)"
              className="w-full p-3 pl-10 bg-gray-50 border border-gray-200 rounded-xl h-24 resize-none focus:ring-2 focus:ring-emerald-500 outline-none text-sm"
            />
          </div>

          <div className="relative">
            <div className="absolute top-3 left-3 text-amber-500"><Coffee size={16} /></div>
            <textarea 
              value={memoSurroundings}
              onChange={(e) => setMemoSurroundings(e.target.value)}
              placeholder="주변 환경 및 상권 (마트, 카페, 혐오시설, 안전함 등)"
              className="w-full p-3 pl-10 bg-gray-50 border border-gray-200 rounded-xl h-24 resize-none focus:ring-2 focus:ring-amber-500 outline-none text-sm"
            />
          </div>

          <div className="relative">
            <div className="absolute top-3 left-3 text-purple-500"><MessageCircle size={16} /></div>
            <textarea 
              value={memoVibe}
              onChange={(e) => setMemoVibe(e.target.value)}
              placeholder="분위기 및 기타 (소음, 주민 균질성, 비행기 소리 등 자유롭게)"
              className="w-full p-3 pl-10 bg-gray-50 border border-gray-200 rounded-xl h-24 resize-none focus:ring-2 focus:ring-purple-500 outline-none text-sm"
            />
          </div>
        </div>

        <button 
          onClick={handleSave}
          disabled={isSaving}
          className="w-full bg-blue-600 text-white font-bold py-4 rounded-xl shadow-lg shadow-blue-200 hover:bg-blue-700 active:transform active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-70"
        >
          {isSaving ? (
            <>
              <Loader2 size={20} className="animate-spin" />
              서버에 안전하게 저장 중...
            </>
          ) : (
            '기록 저장하기'
          )}
        </button>
      </div>
    </div>
  );

  return (
    <div className="w-full max-w-md mx-auto h-[100dvh] flex flex-col bg-white overflow-hidden shadow-2xl relative border-x border-gray-100 font-sans">
      {/* 메인 컨텐츠 영역 */}
      {currentView === 'list' && renderList()}
      {currentView === 'detail' && renderDetail()}
      {currentView === 'add' && renderAdd()}

      {/* 하단 네비게이션 바 (리스트 뷰에서만 표시) */}
      {currentView === 'list' && (
        <div className="absolute bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-6 py-4 flex justify-around items-center pb-safe z-50">
          <button 
            onClick={goToList} 
            className="flex flex-col items-center gap-1 text-blue-600"
          >
            <ListIcon size={24} />
            <span className="text-xs font-semibold">목록</span>
          </button>
          
          <button 
            onClick={goToAdd} 
            className="flex flex-col items-center gap-1 text-gray-400 hover:text-blue-600 transition-colors group"
          >
            <div className="bg-blue-600 text-white p-3 rounded-full -mt-8 shadow-lg shadow-blue-200 group-hover:bg-blue-700 transition-colors">
              <Plus size={28} />
            </div>
            <span className="text-xs font-semibold mt-1">작성하기</span>
          </button>
        </div>
      )}
    </div>
  );
}