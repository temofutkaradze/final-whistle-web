"""Read-only Windows process-tree sampler for this benchmark's own Node process.
Working-set sums include shared pages; sampled peaks are not physical-memory maxima.
"""
import ctypes as c, ctypes.wintypes as w, json, pathlib, sys, time
root=int(sys.argv[1]); folder=pathlib.Path(sys.argv[2]); kernel=c.WinDLL('kernel32',use_last_error=True); psapi=c.WinDLL('psapi')
class Entry(c.Structure):
 _fields_=[('size',w.DWORD),('usage',w.DWORD),('pid',w.DWORD),('heap',c.c_size_t),('module',w.DWORD),('threads',w.DWORD),('parent',w.DWORD),('priority',w.LONG),('flags',w.DWORD),('exe',w.WCHAR*260)]
class Memory(c.Structure):
 _fields_=[('cb',w.DWORD),('faults',w.DWORD)]+[(n,c.c_size_t) for n in ['peak','working','pagedPeak','paged','nonpagedPeak','nonpaged','pagefile','pagefilePeak']]
kernel.CreateToolhelp32Snapshot.restype=w.HANDLE; kernel.OpenProcess.restype=w.HANDLE
kernel.CloseHandle.argtypes=[w.HANDLE]; kernel.Process32FirstW.argtypes=[w.HANDLE,c.POINTER(Entry)];kernel.Process32NextW.argtypes=[w.HANDLE,c.POINTER(Entry)]
kernel.GetProcessTimes.argtypes=[w.HANDLE]+[c.POINTER(w.FILETIME)]*4
psapi.GetProcessMemoryInfo.argtypes=[w.HANDLE,c.POINTER(Memory),w.DWORD]
previous={};summary={};ticks=0
while not (folder/'monitor-stop').exists():
 snap=kernel.CreateToolhelp32Snapshot(2,0);e=Entry();e.size=c.sizeof(e);parents={}
 ok=kernel.Process32FirstW(snap,c.byref(e))
 while ok:parents[e.pid]=e.parent;ok=kernel.Process32NextW(snap,c.byref(e))
 kernel.CloseHandle(snap);wanted={root}
 while True:
  more={p for p,parent in parents.items() if parent in wanted};old=len(wanted);wanted|=more
  if len(wanted)==old:break
 try:phase=json.loads((folder/'phase.json').read_text())['phase']
 except (OSError,ValueError,KeyError):phase='startup'
 rss=0;cpu=0
 for pid in wanted:
  h=kernel.OpenProcess(0x410,False,pid)
  if not h:continue
  m=Memory();m.cb=c.sizeof(m)
  if psapi.GetProcessMemoryInfo(h,c.byref(m),m.cb):rss+=m.working
  times=[w.FILETIME() for _ in range(4)]
  if kernel.GetProcessTimes(h,*[c.byref(t) for t in times]):
   used=sum((t.dwHighDateTime<<32)+t.dwLowDateTime for t in times[2:])/10000
   cpu+=max(0,used-previous.get(pid,used));previous[pid]=used
  kernel.CloseHandle(h)
 s=summary.setdefault(phase,{'samples':0,'peakTreeWorkingSetBytes':0,'sampledTreeCpuMs':0});s['samples']+=1;s['peakTreeWorkingSetBytes']=max(s['peakTreeWorkingSetBytes'],rss);s['sampledTreeCpuMs']+=cpu
 ticks+=1
 if ticks%10==0:(folder/'process-metrics.json').write_text(json.dumps(summary,indent=2))
 time.sleep(.1)
(folder/'process-metrics.json').write_text(json.dumps(summary,indent=2))
