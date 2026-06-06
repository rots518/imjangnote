import React, { useState, useRef, useMemo, useEffect } from 'react';
import { 
  MapPin, Camera, Calendar, ChevronLeft, Plus, List as ListIcon, 
  Trash2, Image as ImageIcon, Building, Search, Users, Map, 
  Train, Home, Coffee, MessageCircle, Loader2, Filter, Edit, Navigation
} from 'lucide-react';

// === Firebase SDK 초기화 부분 ===
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
  { name: '서울역', category: '상권' },
  { name: '강남역', category: '상권' },
  { name: '신논현역', category: '상권' },
  { name: '여의도역', category: '상권' },
  { name: '압구정로데오역', category: '회사' },
  { name: '신용산역', category: '회사' }
];

// 네이티브 이미지 압축 함수 (외부 라이브러리 제거)
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

        // 품질 0.8로 압축하여 Blob 생성
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

  // 카테고리 필터 상태
  const [filterRegion, setFilterRegion] = useState('전체');
  const [filterDistrict, setFilterDistrict] = useState('전체');

  // 폼 상태 (작성 및 수정 공용)
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
  const [existingImages, setExistingImages] = useState([]); // 수정 시 기존 이미지 유지용
  const [newImageFiles, setNewImageFiles] = useState([]); // 실제 업로드될 새 파일
  const [newImagePreviews, setNewImagePreviews] = useState([]); // 화면에 보여줄 새 파일 미리보기
  
  // 기능 상태
  const [isSearching, setIsSearching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false); // 수정 모드 여부
  const [editTargetId, setEditTargetId] = useState(null); // 수정할 문서 ID
  
  const fileInputRef = useRef(null);

  // === 실시간 데이터 동기화 (Firebase Firestore) ===
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'imjang_notes'), (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      // 최신순으로 정렬
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

  // 고유 지역 추출
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
    setIsEditMode(false);
  };

  const goToDetail = (entry) => {
    setSelectedEntry(entry);
    setCurrentView('detail');
  };

  // 새 글 작성 모드로 진입
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
    setExistingImages([]);
    setNewImageFiles([]);
    setNewImagePreviews([]);
    setIsEditMode(false);
    setEditTargetId(null);
    setCurrentView('add');
  };

  // 기존 글 수정 모드로 진입
  const goToEdit = () => {
    setNewName(selectedEntry.name);
    setNewRegion(selectedEntry.region);
    setNewDistrict(selectedEntry.district);
    setNewAddress(selectedEntry.address || '');
    setNewHouseholds(selectedEntry.households || '');
    setNewDate(selectedEntry.date || new Date().toISOString().split('T')[0]);
    setMemoTransport(selectedEntry.memo?.transport || '');
    setMemoCondition(selectedEntry.memo?.condition || '');
    setMemoSurroundings(selectedEntry.memo?.surroundings || '');
    setMemoVibe(selectedEntry.memo?.vibe || '');
    
    // 기존 이미지는 따로 관리
    setExistingImages(selectedEntry.images || []);
    setNewImageFiles([]);
    setNewImagePreviews([]);
    
    setIsEditMode(true);
    setEditTargetId(selectedEntry.id);
    setCurrentView('add');
  };

  // 사진 첨부 및 자동 압축 핸들러
  const handleImageChange = async (e) => {
    const files = Array.from(e.target.files);
    
    try {
      // 선택한 파일들을 압축 처리 (브라우저 기본 API 사용)
      const compressedFiles = await Promise.all(
        files.map(file => compressImage(file, 1, 1920))
      );
      
      setNewImageFiles(prev => [...prev, ...compressedFiles]);
      
      const imageUrls = compressedFiles.map(file => URL.createObjectURL(file));
      setNewImagePreviews(prev => [...prev, ...imageUrls]);
    } catch (error) {
      console.error("이미지 압축 실패:", error);
      alert('이미지 처리 중 오류가 발생했습니다.');
    }
  };

  const removeNewImage = (idx) => {
    setNewImageFiles(prev => prev.filter((_, i) => i !== idx));
    setNewImagePreviews(prev => prev.filter((_, i) => i !== idx));
  };

  const removeExistingImage = (idx) => {
    setExistingImages(prev => prev.filter((_, i) => i !== idx));
  };

  // 단지명 검색 (카카오맵 API 연동)
  const handleSearch = async () => {
    if (!newName.trim()) {
      alert('단지명을 입력해주세요.');
      return;
    }
    
    // 👇 이곳에 카카오 디벨로퍼스에서 발급받은 REST API 키를 넣으세요!
    const KAKAO_REST_API_KEY = 'ec73b276eedaefb216ac1a88193e13c4';
    
    // 안전장치
    if (KAKAO_REST_API_KEY === '실제_REST_API_키를_여기에_넣으세요' || KAKAO_REST_API_KEY === 'API_KEY') {
      alert('코드에 카카오 REST API 키를 먼저 입력해주세요!');
      return;
    }

    setIsSearching(true);
    
    try {
      const response = await fetch(`https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(newName)}`, {
        headers: {
          Authorization: `KakaoAK ${KAKAO_REST_API_KEY}`
        }
      });

      if (!response.ok) throw new Error('API 네트워크 에러');

      const data = await response.json();

      if (data.documents && data.documents.length > 0) {
        const place = data.documents[0];
        const address = place.road_address_name || place.address_name;
        setNewAddress(address);

        const addressParts = place.address_name.split(' ');
        if (addressParts.length >= 2) {
          setNewRegion(addressParts[0]); 
          setNewDistrict(addressParts[1]); 
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

  // === Firebase에 저장 및 수정 ===
  const handleSave = async () => {
    if (!newName.trim()) {
      alert('단지명을 입력해주세요.');
      return;
    }
    if (!newRegion) {
      alert('주소 검색을 완료하거나 지역을 입력해주세요.');
      return;
    }

    setIsSaving(true);

    try {
      // 1. Storage에 새로 추가된 사진만 업로드
      const uploadedImageUrls = [];
      for (const file of newImageFiles) {
        const fileRef = ref(storage, `imjang_photos/${Date.now()}_${file.name}`);
        await uploadBytes(fileRef, file);
        const downloadUrl = await getDownloadURL(fileRef);
        uploadedImageUrls.push(downloadUrl);
      }

      // 최종 이미지 목록 = 기존 이미지 + 새로 업로드된 이미지
      const finalImages = [...existingImages, ...uploadedImageUrls];

      const entryData = {
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
        images: finalImages
      };

      if (isEditMode) {
        // 수정 모드: 기존 데이터 덮어쓰기
        await updateDoc(doc(db, 'imjang_notes', editTargetId), entryData);
      } else {
        // 새 글 작성 모드: 생성 시간 추가 후 새 문서 생성
        entryData.createdAt = serverTimestamp();
        await addDoc(collection(db, 'imjang_notes'), entryData);
      }

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
          <div className="flex items-center gap-1">
            <button onClick={goToEdit} className="text-blue-500 p-2 rounded-full hover:bg-blue-50">
              <Edit size={20} />
            </button>
            <button onClick={() => handleDelete(selectedEntry.id)} className="text-red-500 p-2 rounded-full hover:bg-red-50">
              <Trash2 size={20} />
            </button>
          </div>
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

          {/* ================= 길찾기 영역 추가 ================= */}
          <div className="mb-8">
            <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <Navigation size={16} className="text-blue-500" /> 출퇴근 및 상권 실시간 길찾기
            </h4>
            <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100">
              <p className="text-xs text-blue-600 mb-3">단지에서 해당 지역까지 자차/대중교통 소요시간을 확인합니다.</p>
              <div className="grid grid-cols-2 gap-2">
                {POI_LIST.map((poi, idx) => (
                  <a 
                    key={idx}
                    href={`https://map.kakao.com/?sName=${encodeURIComponent(selectedEntry.name)}&eName=${encodeURIComponent(poi.name)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between bg-white border border-blue-200 p-2.5 rounded-lg text-sm text-gray-700 font-medium hover:bg-blue-50 transition-colors shadow-sm"
                  >
                    <span>{poi.name}</span>
                    <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-sm">{poi.category}</span>
                  </a>
                ))}
              </div>
            </div>
          </div>
          {/* ==================================================== */}

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

  // ================= 렌더링: 작성 및 수정 뷰 =================
  const renderAdd = () => (
    <div className="flex-1 overflow-y-auto bg-white flex flex-col h-full">
      <div className="sticky top-0 bg-white/90 backdrop-blur-md border-b border-gray-100 p-4 flex items-center z-10">
        <button onClick={goToList} className="p-2 -ml-2 text-gray-600 rounded-full hover:bg-gray-100">
          <ChevronLeft size={24} />
        </button>
        <h2 className="text-lg font-bold flex-1 text-center pr-8">
          {isEditMode ? '임장 기록 수정하기' : '새 임장 기록'}
        </h2>
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

        {/* 사진 업로드 (수정 모드 대응) */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center justify-between">
            <span className="flex items-center gap-2"><Camera size={16} /> 현장 사진 (자동 압축)</span>
            <span className="text-[10px] text-gray-400 font-normal">최대 1MB로 최적화됩니다.</span>
          </label>
          
          <div className="flex flex-wrap gap-3">
            {/* 기존 등록했던 이미지 (수정 모드일 때만 보임) */}
            {existingImages.map((imgUrl, idx) => (
              <div key={`existing-${idx}`} className="relative w-20 h-20 opacity-90 border-2 border-blue-200 rounded-xl">
                <img src={imgUrl} className="w-full h-full object-cover rounded-xl" alt="기존 이미지" />
                <button 
                  onClick={() => removeExistingImage(idx)}
                  className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-md"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}

            {/* 새로 추가하는 이미지 미리보기 */}
            {newImagePreviews.map((imgPreviewUrl, idx) => (
              <div key={`new-${idx}`} className="relative w-20 h-20">
                <img src={imgPreviewUrl} className="w-full h-full object-cover rounded-xl border border-gray-200" alt="새 미리보기" />
                <button 
                  onClick={() => removeNewImage(idx)}
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
          className={`w-full text-white font-bold py-4 rounded-xl shadow-lg active:transform active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-70 ${
            isEditMode ? 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200' : 'bg-blue-600 hover:bg-blue-700 shadow-blue-200'
          }`}
        >
          {isSaving ? (
            <>
              <Loader2 size={20} className="animate-spin" />
              서버에 안전하게 저장 중...
            </>
          ) : (
            isEditMode ? '수정한 내용 저장하기' : '새 기록 저장하기'
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