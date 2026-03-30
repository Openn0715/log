import React, { useState, useEffect, useMemo } from 'react';
import { 
  Trash2, Edit3, Plus, X, Check, 
  Menu, FileText, ArrowLeft, TrendingUp, Save, Loader2
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, collection, doc, setDoc, getDoc, 
  onSnapshot, query, addDoc, updateDoc, deleteDoc, 
  serverTimestamp 
} from 'firebase/firestore';
import { 
  getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged 
} from 'firebase/auth';

// --- Firebase 配置 (Rule 3) ---
const firebaseConfig = JSON.parse(__firebase_config);
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'v27-official-cloud';

const App = () => {
  const getLocalDate = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  };

  // --- 狀態管理 ---
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [isAddingBook, setIsAddingBook] = useState(false);
  
  const [books, setBooks] = useState([]); 
  const [activeBookId, setActiveBookId] = useState(null);
  const [records, setRecords] = useState([]);
  
  const [filter, setFilter] = useState('all');
  const [customRange, setCustomRange] = useState({ start: getLocalDate(), end: getLocalDate() });
  const [editingBookId, setEditingBookId] = useState(null);
  const [tempBookName, setTempBookName] = useState('');
  
  const [form, setForm] = useState({ 
    date: getLocalDate(), match: '', market: '', gap: '', odds: '', 
    units: 1, id: null, status: 'pending' 
  });
  const [newBookForm, setNewBookForm] = useState({ name: '', type: 'sports' });
  const [isEditing, setIsEditing] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  // 1. 初始化身份驗證 (Rule 3)
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) { console.error("Auth error", err); }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // 2. 獲取帳簿列表 (Rule 1)
  useEffect(() => {
    if (!user) return;
    const booksRef = collection(db, 'artifacts', appId, 'users', user.uid, 'books');
    const unsubscribe = onSnapshot(booksRef, (snapshot) => {
      const bList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      if (bList.length === 0) {
        // 建立初始預設帳簿
        addDoc(booksRef, { name: '我的體育紀錄', type: 'sports', unitAmount: '1000', createdAt: serverTimestamp() });
      } else {
        setBooks(bList);
        if (!activeBookId) setActiveBookId(bList[0].id);
      }
    }, (err) => console.error("Books snapshot error", err));
    return () => unsubscribe();
  }, [user]);

  // 3. 獲取當前帳簿紀錄 (Rule 1 & 2)
  useEffect(() => {
    if (!user || !activeBookId) return;
    const recsRef = collection(db, 'artifacts', appId, 'users', user.uid, 'records_' + activeBookId);
    const unsubscribe = onSnapshot(recsRef, (snapshot) => {
      const rList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setRecords(rList);
      setIsEditing(false);
    }, (err) => console.error("Records snapshot error", err));
    return () => unsubscribe();
  }, [user, activeBookId]);

  const activeBook = useMemo(() => 
    books.find(b => b.id === activeBookId) || { name: '載入中...', type: 'sports', unitAmount: '1000' }
  , [books, activeBookId]);

  // --- 資料操作替代原本的 LocalStorage ---
  const handleUnitAmountChange = async (newVal) => {
    if (!user || !activeBookId) return;
    const bookRef = doc(db, 'artifacts', appId, 'users', user.uid, 'books', activeBookId);
    await updateDoc(bookRef, { unitAmount: newVal });
  };

  const calculateRecordProfit = (r) => {
    const unitVal = parseFloat(activeBook.unitAmount) || 0;
    const units = parseFloat(r.units) || 0;
    if (activeBook.type === 'baccarat') return units * unitVal;
    if (r.status === 'pending') return 0;
    const odds = parseFloat(r.odds) || 0;
    const betSize = units * unitVal;
    if (r.status === 'win') return betSize * (odds - 1);
    if (r.status === 'loss') return -betSize;
    if (r.status === 'push') return 0; 
    if (r.status === 'half') {
      const gVal = parseFloat(r.gap?.toString().replace(/[^\d.-]/g, '')) || 50;
      const isWinHalf = r.gap?.toString().includes('+') || parseFloat(r.gap) > 0;
      const percentage = Math.abs(gVal) / 100;
      return isWinHalf ? (betSize * (odds - 1)) * percentage : -(betSize * percentage);
    }
    return 0;
  };

  const filteredData = records.filter(r => {
    const today = getLocalDate();
    if (filter === 'all') return true;
    if (filter === 'today') return r.date === today;
    if (filter === 'month') return r.date.substring(0, 7) === today.substring(0, 7);
    if (filter === 'custom') return r.date >= customRange.start && r.date <= customRange.end;
    return true;
  }).sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt?.seconds - a.createdAt?.seconds));

  const totalProfitSum = filteredData.reduce((s, r) => s + calculateRecordProfit(r), 0);
  const winCount = filteredData.filter(r => calculateRecordProfit(r) > 0).length;
  const lossCount = filteredData.filter(r => calculateRecordProfit(r) < 0).length;
  const totalSettled = winCount + lossCount;
  const winRate = totalSettled > 0 ? ((winCount / totalSettled) * 100).toFixed(1) : "0.0";

  const groupedData = filteredData.reduce((groups, record) => {
    const date = record.date;
    if (!groups[date]) groups[date] = [];
    groups[date].push(record);
    return groups;
  }, {});

  const handleRenameBook = async (id) => {
    if (!tempBookName.trim() || !user) return;
    const bookRef = doc(db, 'artifacts', appId, 'users', user.uid, 'books', id);
    await updateDoc(bookRef, { name: tempBookName });
    setEditingBookId(null);
  };

  const handleDeleteBook = async (id) => {
    if (books.length <= 1 || !user) return;
    const bookRef = doc(db, 'artifacts', appId, 'users', user.uid, 'books', id);
    await deleteDoc(bookRef);
    if (activeBookId === id) setActiveBookId(null);
  };

  // --- 報表視窗 ---
  const ReportModal = () => {
    const reportDateRangeText = filter === 'all' ? '全部紀錄' : 
                                filter === 'today' ? `今日 (${getLocalDate()})` : 
                                filter === 'month' ? `本月 (${getLocalDate().substring(0, 7)})` : 
                                `${customRange.start} ~ ${customRange.end}`;

    const dataColumnHeader = activeBook.type === 'sports' ? '賠率' : '注數';

    return (
      <div className="fixed inset-0 bg-white z-[100] overflow-y-auto">
        <div className="max-w-3xl mx-auto p-4 pb-24">
          <button onClick={() => setShowReport(false)} className="flex items-center gap-2 text-slate-500 font-black mb-4">
            <ArrowLeft size={20} /> 返回
          </button>
          <div className="bg-slate-900 text-white p-5 rounded-[1.5rem] shadow-2xl mb-6">
            <div className="mb-3">
                <h2 className="text-lg font-black">{activeBook.name}</h2>
                <p className="text-[10px] text-blue-400 font-bold uppercase mt-1">【統計時段：{reportDateRangeText}】</p>
            </div>
            <div className="grid grid-cols-5 gap-1 pt-3 border-t border-white/10 text-center">
              <StatItem label="盈虧總計" val={Math.round(totalProfitSum).toLocaleString()} color={totalProfitSum >= 0 ? 'text-green-400' : 'text-red-400'} />
              <StatItem label="勝率" val={`${winRate}%`} color="text-yellow-400" />
              <StatItem label="勝場" val={winCount} color="text-green-400" />
              <StatItem label="敗場" val={lossCount} color="text-red-400" />
              <StatItem label="總場次" val={filteredData.length} />
            </div>
          </div>
          <div className="space-y-4">
            {Object.entries(groupedData).map(([date, items]) => (
              <div key={date}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[9px] font-black text-slate-400 px-2 py-0.5 bg-slate-50 rounded-full">{date}</span>
                </div>
                <div className="overflow-hidden border rounded-xl shadow-sm bg-white">
                  <table className="w-full text-left border-collapse table-fixed">
                    <thead>
                      <tr className="bg-slate-50 border-b text-[8px] font-black text-slate-400">
                        <th className="px-3 py-1.5 w-5/12">內容</th>
                        <th className="px-1 py-1.5 text-center w-2/12">{dataColumnHeader}</th>
                        <th className="px-1 py-1.5 text-center w-2/12">結果</th>
                        <th className="px-3 py-1.5 text-right w-3/12">盈虧</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(r => {
                        const p = calculateRecordProfit(r);
                        let sText = '';
                        let dVal = r.odds || r.units;
                        if (activeBook.type === 'baccarat') {
                           sText = r.units > 0 ? '贏' : r.units < 0 ? '輸' : '平';
                        } else {
                           if (r.status === 'pending') sText = '未結';
                           else if (r.status === 'push') sText = '走盤';
                           else if (r.status === 'half') {
                              const isWin = r.gap?.toString().includes('+') || parseFloat(r.gap) > 0;
                              sText = `${isWin ? '贏' : '輸'}50%`;
                           } else { sText = p > 0 ? '贏' : '輸'; }
                        }
                        return (
                          <tr key={r.id} className="border-b last:border-0 text-[10px]">
                            <td className="px-3 py-1.5 font-bold text-slate-700 truncate">{r.match || '-'}</td>
                            <td className="px-1 py-1.5 text-center font-bold text-blue-600">{dVal}</td>
                            <td className={`px-1 py-1.5 text-center font-black ${p > 0 ? 'text-green-500' : p < 0 ? 'text-red-500' : 'text-slate-400'}`}>{sText}</td>
                            <td className={`px-3 py-1.5 text-right font-black ${p > 0 ? 'text-green-500' : p < 0 ? 'text-red-500' : 'text-slate-300'}`}>{Math.round(p).toLocaleString()}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  if (loading) return <div className="h-screen bg-slate-950 flex items-center justify-center text-white font-black italic">V27 CLOUD INITIALIZING...</div>;

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-800 pb-24 font-sans select-none">
      {showReport && <ReportModal />}
      
      {/* 側選單 */}
      {isMenuOpen && <div className="fixed inset-0 bg-slate-900/60 z-50 backdrop-blur-sm" onClick={() => { setIsMenuOpen(false); setEditingBookId(null); }}></div>}
      <div className={`fixed top-0 left-0 h-full w-72 bg-white z-[60] shadow-2xl transition-transform duration-300 ${isMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-6 h-full flex flex-col">
          <div className="flex justify-between items-center mb-8">
            <h2 className="font-black italic text-lg tracking-tight uppercase">Records List</h2>
            <button onClick={() => setIsAddingBook(true)} className="p-2 bg-blue-600 text-white rounded-xl shadow-lg active:scale-90 transition-transform"><Plus size={20} /></button>
          </div>
          <div className="space-y-3 flex-1 overflow-y-auto pr-1">
            {books.map(b => (
              <div key={b.id} className={`group p-4 rounded-2xl cursor-pointer transition-all border ${activeBookId === b.id ? 'bg-blue-600 border-blue-600 text-white shadow-xl' : 'bg-white border-slate-100 text-slate-400 hover:border-blue-200'}`}>
                {editingBookId === b.id ? (
                  <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                    <input autoFocus value={tempBookName} onChange={e => setTempBookName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleRenameBook(b.id)} className="bg-white/20 text-white font-black text-sm p-1 rounded-lg outline-none w-full" />
                    <button onClick={() => handleRenameBook(b.id)} className="p-1"><Save size={16} /></button>
                  </div>
                ) : (
                  <div className="flex justify-between items-center" onClick={() => { setActiveBookId(b.id); setIsMenuOpen(false); }}>
                    <div className="flex flex-col min-w-0">
                      <span className="font-black text-sm truncate">{b.name}</span>
                      <span className={`text-[8px] font-black uppercase mt-0.5 ${activeBookId === b.id ? 'opacity-60' : 'text-blue-500'}`}>{b.type === 'sports' ? '體育' : '百家樂'}</span>
                    </div>
                    <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                       <button onClick={(e) => { e.stopPropagation(); setEditingBookId(b.id); setTempBookName(b.name); }} className={`${activeBookId === b.id ? 'text-white' : 'text-slate-400'} p-1`}><Edit3 size={14} /></button>
                       <button onClick={(e) => { e.stopPropagation(); handleDeleteBook(b.id); }} className={`${activeBookId === b.id ? 'text-white' : 'text-slate-400'} p-1`}><Trash2 size={14} /></button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="pt-4 border-t text-[8px] font-black text-slate-300 uppercase tracking-widest text-center">Cloud Sync Version 27</div>
        </div>
      </div>

      {/* 頂部看板 */}
      <div className="bg-white border-b sticky top-0 z-40 px-4 pt-3 pb-2 shadow-sm">
        <div className="max-w-lg mx-auto">
          <div className="flex justify-between items-center mb-3">
            <button onClick={() => setIsMenuOpen(true)} className="p-2 -ml-2 text-slate-400"><Menu size={24} /></button>
            <div className="text-center min-w-0 px-4">
              <h1 className="text-xs font-black text-slate-800 truncate uppercase">{activeBook.name}</h1>
              <div className="text-[7px] font-black text-blue-500 mt-0.5 uppercase tracking-tighter">
                【 {filter==='all'?'全部顯示':filter==='today'?'當日數據':filter==='month'?'本月統計':`${customRange.start} ~ ${customRange.end}`} 】
              </div>
            </div>
            <button onClick={() => setShowReport(true)} className="p-2 bg-slate-800 text-white rounded-xl shadow-lg active:scale-95 transition-transform"><FileText size={18} /></button>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            <MiniStat label="盈虧總計" val={Math.round(totalProfitSum).toLocaleString()} color={totalProfitSum >= 0 ? 'text-green-600' : 'text-red-600'} />
            <MiniStat label="勝率%" val={`${winRate}%`} color="text-blue-600" />
            <div className="bg-slate-50 p-2.5 rounded-2xl border border-slate-100 flex flex-col items-center flex-1 min-w-0">
                <div className="text-[7px] text-slate-400 font-black mb-0.5 uppercase tracking-tighter truncate w-full text-center">勝 / 敗</div>
                <div className="text-[10px] font-black truncate w-full text-center flex justify-center gap-1">
                    <span className="text-green-600">{winCount}</span>
                    <span className="text-slate-300">/</span>
                    <span className="text-red-600">{lossCount}</span>
                </div>
            </div>
            <MiniStat label="總場次" val={filteredData.length} color="text-slate-400" />
          </div>
        </div>
      </div>

      <div className="p-4 max-w-lg mx-auto">
        <div className="flex gap-1 bg-white p-1 rounded-2xl border mb-2 shadow-sm">
          {['all', 'today', 'month', 'custom'].map(f => (
            <button key={f} onClick={() => setFilter(f)} className={`flex-1 py-1.5 rounded-xl text-[10px] font-black transition-all ${filter === f ? 'bg-slate-800 text-white shadow-md' : 'text-slate-400'}`}>
              {f==='all'?'全部':f==='today'?'今日':f==='month'?'本月':'自定義'}
            </button>
          ))}
        </div>

        {filter === 'custom' && (
          <div className="bg-white p-3 rounded-2xl border mb-4 flex gap-2 items-center shadow-sm">
            <input type="date" value={customRange.start} onChange={e => setCustomRange({...customRange, start: e.target.value})} className="flex-1 bg-slate-50 p-2 rounded-xl text-[10px] font-black outline-none border border-slate-100" />
            <span className="text-slate-300 text-[10px] font-bold">至</span>
            <input type="date" value={customRange.end} onChange={e => setCustomRange({...customRange, end: e.target.value})} className="flex-1 bg-slate-50 p-2 rounded-xl text-[10px] font-black outline-none border border-slate-100" />
          </div>
        )}

        <div className="mb-4 bg-blue-600 p-3 rounded-2xl flex items-center justify-between shadow-lg relative overflow-hidden">
           <div className="flex items-center gap-2 relative z-10">
              <TrendingUp size={16} className="text-blue-200" />
              <span className="text-[11px] font-black text-white">單注金額：</span>
           </div>
           <div className="flex items-center bg-white/20 backdrop-blur-md rounded-xl px-3 py-1.5 relative z-10 border border-white/20">
              <span className="text-blue-100 text-[10px] font-black mr-2">$</span>
              <input type="number" value={activeBook.unitAmount || '1000'} onChange={e => handleUnitAmountChange(e.target.value)} className="bg-transparent text-white font-black text-sm outline-none w-20 text-center" />
           </div>
        </div>

        {/* 新增表單 */}
        <div className="bg-white rounded-[1.5rem] shadow-sm border border-slate-100 overflow-hidden mb-6">
          <form className="p-4 grid grid-cols-12 gap-2" onSubmit={async (e) => {
            e.preventDefault();
            if (!user || !activeBookId) return;
            if (activeBook.type === 'sports' && (!form.match || !form.odds)) return;
            if (activeBook.type === 'baccarat' && !form.units) return;

            const colRef = collection(db, 'artifacts', appId, 'users', user.uid, 'records_' + activeBookId);
            if (isEditing) {
              await updateDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'records_' + activeBookId, form.id), { ...form });
            } else {
              await addDoc(colRef, { ...form, createdAt: serverTimestamp() });
            }
            setForm({ date: getLocalDate(), match: '', market: '', gap: '', odds: '', units: 1, id: null, status: 'pending' });
            setIsEditing(false);
          }}>
            <div className="col-span-12"><input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="input-field text-[11px]" /></div>
            <div className="col-span-12"><input value={form.match} onChange={e => setForm({ ...form, match: e.target.value })} className="input-field text-[11px]" placeholder={activeBook.type === 'sports' ? "項目/對戰 (例: 快艇)" : "備註/局數"} /></div>
            {activeBook.type === 'sports' ? (
              <>
                <div className="col-span-6"><input value={form.market} onChange={e => setForm({ ...form, market: e.target.value })} className="input-field text-[11px]" placeholder="盤口" /></div>
                <div className="col-span-6"><input value={form.gap} onChange={e => setForm({ ...form, gap: e.target.value })} className="input-field text-[11px]" placeholder="分洞" /></div>
                <div className="col-span-6"><input type="number" step="0.01" value={form.odds} onChange={e => setForm({ ...form, odds: e.target.value })} className="input-field text-[11px] text-center bg-blue-50/50" placeholder="賠率 1.95" /></div>
                <div className="col-span-6"><input type="number" step="0.1" value={form.units} onChange={e => setForm({ ...form, units: e.target.value })} className="input-field text-[11px] text-center bg-blue-50/50" placeholder="注數" /></div>
              </>
            ) : (
              <div className="col-span-12"><input type="number" step="0.01" value={form.units} onChange={e => setForm({ ...form, units: e.target.value })} className="input-field text-[11px] text-center bg-green-50/50 font-black" placeholder="贏輸注數 (負號為輸)" /></div>
            )}
            <button type="submit" className={`col-span-12 py-3 rounded-xl text-white font-black text-xs shadow-md mt-1 ${isEditing ? 'bg-orange-500' : 'bg-blue-600'}`}>
               {isEditing ? '更新內容' : '確認儲存至雲端'}
            </button>
          </form>
        </div>

        {/* 歷史紀錄 */}
        <div className="space-y-4">
          {Object.entries(groupedData).map(([date, dayRecords]) => (
            <div key={date}>
              <div className="sticky top-[155px] z-10 mb-1.5">
                <span className="bg-slate-900 text-white text-[7px] font-black px-2 py-0.5 rounded-full shadow-sm">{date.replace(/-/g, '/')}</span>
              </div>
              <div className="space-y-1">
                {dayRecords.map(r => {
                  const profit = calculateRecordProfit(r);
                  return (
                    <div key={r.id} className="bg-white px-2 py-1.5 rounded-xl shadow-sm border border-slate-50 flex items-center gap-2 relative overflow-hidden group">
                      <div className={`w-0.5 h-5 rounded-full shrink-0 ${activeBook.type === 'sports' && r.status === 'pending' ? 'bg-slate-100' : profit > 0 ? 'bg-green-500' : profit < 0 ? 'bg-red-500' : 'bg-orange-400'}`}></div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-[10px] font-black text-slate-700 truncate leading-tight">{r.match || '無標題'}</h3>
                        <div className="text-[7px] font-bold text-slate-400 tracking-tighter leading-none mt-0.5">
                          {activeBook.type === 'sports' ? `${r.odds} @ ${r.units}注 | ${r.market} ${r.gap}` : `${r.units}注`}
                        </div>
                      </div>
                      {activeBook.type === 'sports' && (
                        <div className="flex gap-0.5 shrink-0">
                          <StatusBtn active={r.status==='win'} color="bg-green-500" icon={<Check size={10} strokeWidth={4}/>} onClick={()=>updateDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'records_'+activeBookId, r.id), {status:'win'})} />
                          <StatusBtn active={r.status==='loss'} color="bg-red-500" icon={<X size={10} strokeWidth={4}/>} onClick={()=>updateDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'records_'+activeBookId, r.id), {status:'loss'})} />
                          <StatusBtn active={r.status==='push'} color="bg-orange-400" icon={<span className="text-[7px] font-black">走</span>} onClick={()=>updateDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'records_'+activeBookId, r.id), {status:'push'})} />
                          <StatusBtn active={r.status==='half'} color="bg-slate-700" icon={<span className="text-[7px] font-black">卡</span>} onClick={()=>updateDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'records_'+activeBookId, r.id), {status:'half'})} />
                        </div>
                      )}
                      <div className="text-right min-w-[55px]">
                        <div className={`text-[10px] font-black leading-tight ${profit > 0 ? 'text-green-500' : profit < 0 ? 'text-red-500' : 'text-slate-300'}`}>
                          {profit !== 0 ? (profit > 0 ? '+' : '') + Math.round(profit).toLocaleString() : '0'}
                        </div>
                        <div className="flex gap-2 justify-end mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => { setIsEditing(true); setForm(r); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="text-slate-300 hover:text-blue-500"><Edit3 size={8} /></button>
                          <button onClick={() => setDeletingId(r.id)} className="text-slate-300 hover:text-red-500"><Trash2 size={8} /></button>
                        </div>
                      </div>
                      {deletingId === r.id && (
                        <div className="absolute inset-0 bg-white/95 z-20 flex items-center justify-center gap-2">
                          <span className="text-[8px] font-black text-red-600 uppercase">Delete?</span>
                          <button onClick={async () => { await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'records_'+activeBookId, r.id)); setDeletingId(null); }} className="bg-red-500 text-white px-2 py-0.5 rounded-lg text-[8px] font-black">Confirm</button>
                          <button onClick={() => setDeletingId(null)} className="bg-slate-100 text-slate-500 px-2 py-0.5 rounded-lg text-[8px] font-black">Cancel</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        .input-field { width: 100%; background: #F1F5F9; border: 2px solid transparent; border-radius: 10px; font-weight: 800; color: #1E293B; outline: none; padding: 8px 12px; transition: all 0.2s; }
        .input-field:focus { border-color: #3B82F6; background: white; }
      `}</style>

      {isAddingBook && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-md">
          <div className="bg-white w-full max-w-xs rounded-[2rem] p-8 shadow-2xl animate-in zoom-in-95 duration-200">
            <h3 className="text-xl font-black mb-6 text-center text-slate-800 uppercase tracking-tighter">New Book</h3>
            <div className="space-y-4 mb-8">
              <input value={newBookForm.name} onChange={e => setNewBookForm({...newBookForm, name: e.target.value})} className="input-field" placeholder="名稱" />
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setNewBookForm({...newBookForm, type: 'sports'})} className={`py-4 rounded-xl text-[10px] font-black transition-all ${newBookForm.type === 'sports' ? 'bg-blue-600 text-white shadow-lg' : 'bg-slate-50 text-slate-400'}`}>體育</button>
                <button onClick={() => setNewBookForm({...newBookForm, type: 'baccarat'})} className={`py-4 rounded-xl text-[10px] font-black transition-all ${newBookForm.type === 'baccarat' ? 'bg-indigo-600 text-white shadow-lg' : 'bg-slate-50 text-slate-400'}`}>百家樂</button>
              </div>
            </div>
            <button onClick={async () => {
              if (!newBookForm.name || !user) return;
              const colRef = collection(db, 'artifacts', appId, 'users', user.uid, 'books');
              const res = await addDoc(colRef, { name: newBookForm.name, type: newBookForm.type, unitAmount: '1000', createdAt: serverTimestamp() });
              setActiveBookId(res.id);
              setNewBookForm({ name: '', type: 'sports' });
              setIsAddingBook(false);
              setIsMenuOpen(false);
            }} className="w-full bg-slate-800 text-white py-4 rounded-xl font-black text-xs shadow-xl active:scale-95 transition-transform uppercase">Create Now</button>
            <button onClick={() => setIsAddingBook(false)} className="w-full text-slate-400 text-[10px] font-bold mt-4 text-center">取消</button>
          </div>
        </div>
      )}
    </div>
  );
};

const StatusBtn = ({ active, color, icon, onClick }) => (
  <button onClick={onClick} className={`w-6 h-6 rounded flex items-center justify-center transition-all ${active ? `${color} text-white shadow-sm scale-105` : 'bg-slate-50 text-slate-300 hover:bg-slate-100'}`}>
    {icon}
  </button>
);

const MiniStat = ({ label, val, color }) => (
  <div className="bg-slate-50 p-2 rounded-xl border border-slate-100 flex flex-col items-center flex-1 min-w-0">
    <div className="text-[6px] text-slate-400 font-black mb-0.5 uppercase tracking-tighter truncate w-full text-center">{label}</div>
    <div className={`text-[10px] font-black truncate w-full text-center ${color || 'text-slate-700'}`}>{val}</div>
  </div>
);

const StatItem = ({ label, val, color }) => (
  <div className="text-center flex-1">
    <div className="text-[7px] font-black opacity-40 mb-1 uppercase tracking-widest">{label}</div>
    <div className={`text-[11px] font-black truncate px-1 ${color || 'text-white'}`}>{val}</div>
  </div>
);

export default App;

