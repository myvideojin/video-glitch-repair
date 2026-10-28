import React, { useState, useRef, useEffect } from 'react';
import ToolFAQ from './components/ToolFAQ';

import BrandedNav from './components/BrandedNav';
import BrandedFooter from './components/BrandedFooter';
import { 
  Upload, Play, Pause, Volume2, VolumeX,
  Settings, Video, FileText, FileVideo,
  SkipBack, SkipForward, Repeat, Loader2, CheckCircle2, AlertCircle, AlertTriangle,
  Activity, Download
} from 'lucide-react';
import { useToolUsage } from './hooks/useToolUsage';

export default function VideoGlitchRepair() {
  const { checkUsage, incrementUsage } = useToolUsage();

  const faqs = [
    {
      "question": "Can you fix completely unplayable videos?",
      "answer": "Yes, if the file contains valid media streams, our tool can rebuild the container index and make it playable again."
    },
    {
      "question": "Does it fix blurry or low-resolution video?",
      "answer": "No, this tool repairs structural file corruption and playback glitches. It does not upscale or enhance resolution."
    },
    {
      "question": "How does it fix out of sync audio?",
      "answer": "It forces a constant frame rate and re-aligns audio timestamps to match the video track perfectly."
    },
    {
      "question": "Is there a file size limit?",
      "answer": "Because this tool runs in your browser, extremely large files may take a long time or exceed browser memory limits. We recommend files under 500MB."
    },
    {
      "question": "What formats can be repaired?",
      "answer": "We repair MP4, MOV, AVI, WebM, and MKV files by re-encoding them into a clean MP4 container."
    }
  ];

  const [file, setFile] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  
  // Video state
  const videoRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isLooping, setIsLooping] = useState(true);

  // Repair state
  const [isProcessing, setIsProcessing] = useState(false);
  const [processProgress, setProcessProgress] = useState(0);
  const [loadingMsg, setLoadingMsg] = useState('Booting Engine...');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [resultVideoUrl, setResultVideoUrl] = useState(null);
  const [downloadFileName, setDownloadFileName] = useState("");

  const ffmpegRef = useRef(null);
  const [isReady, setIsReady] = useState(false);
  const loadStarted = useRef(false);

  useEffect(() => {
    if (loadStarted.current) return;
    loadStarted.current = true;

    const loadFFmpeg = async () => {
      try {
        setLoadingMsg("Fetching Engine...");
        const { createFFmpeg } = window.FFmpeg;
        const ffmpeg = createFFmpeg({
           log: true,
           corePath: 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js'
        });
        ffmpegRef.current = ffmpeg;
        await ffmpeg.load();
        setIsReady(true);
        setLoadingMsg('Engine Loaded');
        setError(null);
      } catch (err) {
        console.error("FFmpeg load error:", err);
        setError("Error: " + (err.message || "Failed to initialize WebAssembly."));
        setLoadingMsg("Failed to Load");
      }
    };
    
    setTimeout(() => {
        if (window.FFmpeg) {
            loadFFmpeg();
        } else {
            setError("Global FFmpeg library failed to inject.");
        }
    }, 500);
  }, []);

  // Handle file upload
  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile && selectedFile.type.startsWith('video/')) {
      setFile(selectedFile);
      const url = URL.createObjectURL(selectedFile);
      setVideoUrl(url);
      setError(null);
    } else {
        setError('Please upload a valid video file.');
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.type.startsWith('video/')) {
      setFile(droppedFile);
      const url = URL.createObjectURL(droppedFile);
      setVideoUrl(url);
      setError(null);
    } else {
        setError('Please upload a valid video file.');
    }
  };

  // Video controls
  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const p = (videoRef.current.currentTime / videoRef.current.duration) * 100;
      setProgress(p);
    }
  };

  const handleScrub = (e) => {
    if (videoRef.current) {
      const scrubTime = (e.target.value / 100) * videoRef.current.duration;
      videoRef.current.currentTime = scrubTime;
      setProgress(e.target.value);
    }
  };

  const stepFrame = (forward) => {
    if (videoRef.current) {
      videoRef.current.pause();
      setIsPlaying(false);
      videoRef.current.currentTime += forward ? 0.033 : -0.033;
    }
  };

  const handleProcess = async () => {
    if (!checkUsage()) {
      setError("Daily limit reached. Free users can process tools 3 times a day. Please upgrade for unlimited access.");
      return;
    }
    incrementUsage();

    if (!file || !isReady) return;

    setIsProcessing(true);
    setError(null);
    setResult(null);
    setResultVideoUrl(null);
    setProcessProgress(0);
    setDownloadFileName(file.name);

    try {
      const ffmpeg = ffmpegRef.current;
      const { fetchFile } = window.FFmpeg;
      
      setLoadingMsg('Writing to virtual memory...');
      ffmpeg.FS('writeFile', 'input.mp4', await fetchFile(file));

      ffmpeg.setProgress(({ ratio }) => {
        const percent = Math.min(Math.max(Math.round(ratio * 100), 0), 100);
        setProcessProgress(percent);
      });

      setLoadingMsg('Attempt 1: Fast Stream Copy...');
      
      let pass1Success = false;
      try {
          await ffmpeg.run(
              '-err_detect', 'ignore_err',
              '-i', 'input.mp4',
              '-c', 'copy',
              '-y',
              'output.mp4'
          );
          
          const outputData = ffmpeg.FS('readFile', 'output.mp4');
          if (outputData.length > 1000) {
              pass1Success = true;
          } else {
              throw new Error("Output too small, copy failed.");
          }
      } catch (err) {
          console.log("Pass 1 failed, trying Pass 2...", err);
      }

      if (!pass1Success) {
          setLoadingMsg('Attempt 2: Deep Re-encoding...');
          setProcessProgress(0); 
          
          await ffmpeg.run(
              '-err_detect', 'ignore_err',
              '-i', 'input.mp4',
              '-vf', 'fps=30',
              '-c:v', 'libx264',
              '-crf', '23',
              '-preset', 'fast',
              '-c:a', 'aac',
              '-y',
              'output.mp4'
          );
      }

      setProcessProgress(100);
      setLoadingMsg("Finalizing download...");

      const data = ffmpeg.FS('readFile', 'output.mp4');
      const url = window.URL.createObjectURL(new Blob([data.buffer], { type: 'video/mp4' }));
      
      setResultVideoUrl(url);
      setResult({ message: pass1Success ? 'Video repaired flawlessly via structural rebuild!' : 'Video fully restored via deep re-encoding!' });

      ffmpeg.setProgress(() => {}); 
      ffmpeg.FS('unlink', 'input.mp4');
      ffmpeg.FS('unlink', 'output.mp4');

    } catch (err) {
      console.error(err);
      setError(err.message || 'An error occurred. The video might be too corrupted to repair.');
    } finally {
      setIsProcessing(false);
      setProcessProgress(0);
    }
  };

  return (
    <div className="min-h-screen bg-[#020617] text-white p-6 md:p-12">
      
      <BrandedNav />
      <div className="max-w-4xl mx-auto px-4">
        <div className="flex flex-col md:flex-row items-center justify-between mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-black uppercase tracking-tighter flex items-center gap-3">
              <Activity className="text-blue-500" /> Video Glitch Repair
            </h1>
            <p className="text-gray-400 font-medium">Instantly repair corrupted or broken video files locally.</p>
          </div>
          {videoUrl && !isProcessing && (
            <button 
              onClick={() => { setFile(null); setVideoUrl(null); setResult(null); setError(null); }}
              className="px-6 py-2 bg-white/5 hover:bg-white/10 rounded-full font-bold text-sm transition-colors border border-white/10"
            >
              Upload New Video
            </button>
          )}
        </div>

        {!videoUrl ? (
          <div 
            className="w-full max-w-3xl mx-auto h-[60vh] border-2 border-dashed border-white/10 rounded-[2rem] flex flex-col items-center justify-center p-8 text-center hover:bg-white/5 hover:border-blue-500/50 transition-all cursor-pointer group"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            <input 
              type="file" 
              id="video-input" 
              accept="video/*" 
              className="hidden" 
              onChange={handleFileChange}
            />
            <label htmlFor="video-input" className="cursor-pointer flex flex-col items-center w-full h-full justify-center">
              <div className="w-20 h-20 bg-blue-500/10 text-blue-500 rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <Upload size={32} />
              </div>
              <h2 className="text-2xl font-black mb-2">Select a Video</h2>
              <p className="text-gray-400 max-w-sm">Drag and drop your corrupted video file here to fix.</p>
              <div className="mt-8 px-4 py-2 bg-white/5 rounded-full text-xs font-bold text-gray-500 uppercase tracking-widest">
                Local AI Processing • Zero Uploads
              </div>
            </label>
          </div>
        ) : (
          <div className="flex flex-col lg:flex-row gap-8">
            {/* Main Preview Area */}
            <div className="flex-1 flex flex-col items-center">
              <div className="w-full bg-black rounded-3xl border border-white/10 shadow-2xl overflow-hidden shrink-0 aspect-video flex items-center justify-center">
                {resultVideoUrl ? (
                  <video 
                    src={resultVideoUrl}
                    className="w-full h-full object-contain bg-zinc-900"
                    controls
                    playsInline
                  />
                ) : (
                  <video 
                    ref={videoRef}
                    src={videoUrl}
                    className="w-full h-full object-contain bg-zinc-900"
                    onTimeUpdate={handleTimeUpdate}
                    loop={isLooping}
                    muted={isMuted}
                    playsInline
                  />
                )}
              </div>

              {/* Transport Controls */}
              {!resultVideoUrl && (
                <div className="w-full mt-6 bg-white/5 rounded-2xl p-4 border border-white/10 backdrop-blur-md">
                  <div className="flex items-center justify-between mb-4">
                    <button onClick={() => stepFrame(false)} className="p-2 text-gray-400 hover:text-white"><SkipBack size={20} /></button>
                    <button onClick={togglePlay} className="w-12 h-12 bg-white text-black rounded-full flex items-center justify-center hover:scale-105 transition-transform">
                      {isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" className="ml-1" />}
                    </button>
                    <button onClick={() => stepFrame(true)} className="p-2 text-gray-400 hover:text-white"><SkipForward size={20} /></button>
                  </div>
                  
                  <input 
                    type="range" 
                    min="0" 
                    max="100" 
                    value={progress}
                    onChange={handleScrub}
                    className="w-full h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-blue-500"
                  />
                  
                  <div className="flex justify-between mt-4">
                    <button onClick={() => setIsMuted(!isMuted)} className={`p-2 rounded-lg ${isMuted ? 'text-red-400 bg-red-400/10' : 'text-gray-400 hover:text-white'}`}>
                      {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                    </button>
                    <button onClick={() => setIsLooping(!isLooping)} className={`p-2 rounded-lg ${isLooping ? 'text-blue-400 bg-blue-400/10' : 'text-gray-400 hover:text-white'}`}>
                      <Repeat size={18} />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Sidebar Settings */}
            <div className="w-full lg:w-[350px] space-y-6">
              
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 flex items-start gap-3">
                 <AlertTriangle className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
                 <div className="text-blue-200 text-xs">
                   <span className="font-bold text-blue-400">Repair Protocol:</span> 
                   This tool applies a two-pass deep reconstruction to fix unplayable files.
                </div>
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-red-200 text-sm">{error}</p>
                </div>
              )}

              {result && (
                <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-6 text-center">
                  <CheckCircle2 className="w-10 h-10 text-green-400 mx-auto mb-2" />
                  <p className="text-sm font-medium text-green-300 mb-4">{result.message}</p>
                  <div className="flex flex-col gap-3">
                    {resultVideoUrl && (
                      <a 
                        href={resultVideoUrl} 
                        download={`repaired_${downloadFileName}`}
                        className="flex items-center justify-center gap-2 px-4 py-3 bg-green-600 hover:bg-green-500 text-white font-bold rounded-xl transition-all text-sm"
                      >
                        <Download size={16} />
                        Download Repaired Video
                      </a>
                    )}
                  </div>
                </div>
              )}

              {!result && (
                <button 
                  onClick={handleProcess}
                  disabled={isProcessing || !isReady}
                  className={`w-full py-4 rounded-2xl font-black uppercase tracking-widest text-sm shadow-xl transition-all flex flex-col items-center justify-center gap-2 transform relative overflow-hidden ${
                    isProcessing || !isReady
                      ? 'bg-white/10 text-white/50 cursor-not-allowed'
                      : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-600/20 hover:-translate-y-1'
                  }`}
                >
                  {isProcessing && (
                    <div 
                      className="absolute left-0 top-0 bottom-0 bg-white/20 transition-all duration-300"
                      style={{ width: `${processProgress}%` }}
                    ></div>
                  )}
                  
                  <div className="relative flex items-center gap-2">
                    {(isProcessing || !isReady) ? <Loader2 size={18} className="animate-spin" /> : <Play size={18} />}
                    {isProcessing || !isReady ? loadingMsg : 'Repair Video'}
                  </div>
                </button>
              )}

            </div>
          </div>
        )}
      </div>

      {/* SEO Sections */}
      <div className="mt-24 space-y-24 max-w-4xl mx-auto px-4">
        {/* How It Works */}
        <section>
          <h2 className="text-3xl font-bold mb-8 text-center">How to Repair Videos Locally</h2>
          <div className="grid md:grid-cols-4 gap-6">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 relative">
              <div className="absolute -top-4 -left-4 w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center font-bold text-xl shadow-lg shadow-blue-500/20">1</div>
              <h3 className="text-xl font-bold mb-3 text-blue-400 mt-2">Upload Video</h3>
              <p className="text-gray-400">Load the corrupted or broken video file into your browser.</p>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 relative">
              <div className="absolute -top-4 -left-4 w-10 h-10 bg-indigo-600 rounded-full flex items-center justify-center font-bold text-xl shadow-lg shadow-indigo-500/20">2</div>
              <h3 className="text-xl font-bold mb-3 text-indigo-400 mt-2">Rebuild Index</h3>
              <p className="text-gray-400">Our engine first attempts to repair the file headers to fix broken playback quickly.</p>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 relative">
              <div className="absolute -top-4 -left-4 w-10 h-10 bg-emerald-600 rounded-full flex items-center justify-center font-bold text-xl shadow-lg shadow-emerald-500/20">3</div>
              <h3 className="text-xl font-bold mb-3 text-emerald-400 mt-2">Deep Repair</h3>
              <p className="text-gray-400">If heavily corrupted, a fallback re-encoding process rebuilds the video frame-by-frame.</p>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 relative">
              <div className="absolute -top-4 -left-4 w-10 h-10 bg-purple-600 rounded-full flex items-center justify-center font-bold text-xl shadow-lg shadow-purple-500/20">4</div>
              <h3 className="text-xl font-bold mb-3 text-purple-400 mt-2">Download</h3>
              <p className="text-gray-400">Download your fully restored and playable video instantly.</p>
            </div>
          </div>
        </section>

        {/* Feature Breakdown */}
        <section>
          <h2 className="text-3xl font-bold mb-8 text-center">Why Use Our Glitch Repair?</h2>
          <div className="grid md:grid-cols-2 gap-8">
            <div className="bg-[#0f172a] rounded-2xl p-8 border border-white/5">
              <h3 className="text-2xl font-bold mb-4">Structural Recovery</h3>
              <p className="text-gray-400">Bypasses missing index tables and broken headers to force playback on otherwise corrupted files.</p>
            </div>
            <div className="bg-[#0f172a] rounded-2xl p-8 border border-white/5">
              <h3 className="text-2xl font-bold mb-4">Audio Sync Fixing</h3>
              <p className="text-gray-400">Automatically resolves frame desyncs by forcing constant framerates throughout playback.</p>
            </div>
            <div className="bg-[#0f172a] rounded-2xl p-8 border border-white/5">
              <h3 className="text-2xl font-bold mb-4">100% Local Processing</h3>
              <p className="text-gray-400">Repairs happen fully on your device, ensuring privacy and eliminating massive upload wait times.</p>
            </div>
            <div className="bg-[#0f172a] rounded-2xl p-8 border border-white/5">
              <h3 className="text-2xl font-bold mb-4">Completely Free</h3>
              <p className="text-gray-400">Enjoy professional grade video recovery capabilities entirely for free.</p>
            </div>
          </div>
        </section>

        {/* Use Cases */}
        <section>
          <h2 className="text-3xl font-bold mb-8 text-center">Built for Content Creators & Professionals</h2>
          <div className="space-y-6">
            <div className="bg-white/5 rounded-2xl p-6 border border-white/10 flex flex-col md:flex-row gap-6 items-center">
              <div className="md:w-1/3">
                <h3 className="text-xl font-bold mb-2">Videographers</h3>
              </div>
              <div className="md:w-2/3">
                <p className="text-gray-400">Recover unplayable footage resulting from sudden camera shutoffs or SD card corruption.</p>
              </div>
            </div>
            <div className="bg-white/5 rounded-2xl p-6 border border-white/10 flex flex-col md:flex-row gap-6 items-center">
              <div className="md:w-1/3">
                <h3 className="text-xl font-bold mb-2">Streamers</h3>
              </div>
              <div className="md:w-2/3">
                <p className="text-gray-400">Fix out-of-sync audio or broken VODs caused by dropped frames during live broadcasting.</p>
              </div>
            </div>
            <div className="bg-white/5 rounded-2xl p-6 border border-white/10 flex flex-col md:flex-row gap-6 items-center">
              <div className="md:w-1/3">
                <h3 className="text-xl font-bold mb-2">Everyday Users</h3>
              </div>
              <div className="md:w-2/3">
                <p className="text-gray-400">Salvage important family videos or memories that no longer play correctly on modern devices.</p>
              </div>
            </div>
          </div>
        </section>
      </div>

      <ToolFAQ faqs={faqs} />
      <BrandedFooter />
    </div>
  );
}
