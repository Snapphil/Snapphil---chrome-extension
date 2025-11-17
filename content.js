 (function() {
   if (typeof window.jobAppAutomatorLoaded !== 'undefined') return;
   window.jobAppAutomatorLoaded = true;
   
   console.log("AI-Powered Job Application Automator loaded");

  // html2pdf is now loaded directly via manifest content_scripts
  function loadRequiredLibraries() {
    return Promise.resolve();
  }

   // Add logging system
   const logSystem = {
     logs: [],
     maxLogs: 50,
     container: null,
     
     init() {
       if (this.container) return this.container;
       
       // Create log container
       this.container = document.createElement('div');
       this.container.className = 'snapphil-log-window hidden';
       this.container.innerHTML = `
         <div class="log-header">
           <div class="log-title">SnapPhil Debug Log</div>
           <div class="log-controls">
             <button class="log-clear-btn" title="Clear logs"><i class="fas fa-eraser"></i></button>
             <button class="log-close-btn" title="Close logs"><i class="fas fa-times"></i></button>
           </div>
         </div>
         <div class="log-content"></div>
       `;
       
       // Add styles
       const style = document.createElement('style');
       style.textContent = `
         .snapphil-log-window {
           position: fixed;
           bottom: 30px;
           left: 50%;
           transform: translateX(-50%);
           width: 500px;
           height: 200px;
           background-color: rgba(12, 13, 17, 0.95);
           border-radius: 8px;
           border: 1px solid rgba(255, 255, 255, 0.1);
           box-shadow: 0 4px 20px rgba(0,0,0,0.3);
           z-index: 2147483646;
           font-family: 'SF Mono', Consolas, Monaco, monospace;
           font-size: 11px;
           overflow: hidden;
           display: flex;
           flex-direction: column;
           transition: all 0.3s ease;
           color: #e3e3e3;
         }
         .snapphil-log-window.hidden {
           opacity: 0;
           transform: translate(-50%, 70px);
           pointer-events: none;
         }
         .log-header {
           display: flex;
           align-items: center;
           justify-content: space-between;
           padding: 8px 10px;
           background: rgba(0, 0, 0, 0.2);
           border-bottom: 1px solid rgba(255, 255, 255, 0.05);
         }
         .log-title {
           font-weight: bold;
           color: #f0a830;
         }
         .log-controls {
           display: flex;
           gap: 5px;
         }
         .log-clear-btn, .log-close-btn {
           background: none;
           border: none;
           color: rgba(255, 255, 255, 0.6);
           cursor: pointer;
           width: 24px;
           height: 24px;
           border-radius: 4px;
           display: flex;
           align-items: center;
           justify-content: center;
         }
         .log-clear-btn:hover, .log-close-btn:hover {
           background: rgba(255, 255, 255, 0.1);
           color: rgba(255, 255, 255, 0.9);
         }
         .log-content {
           padding: 5px 10px;
           overflow-y: auto;
           flex: 1;
         }
         .log-entry {
           margin-bottom: 2px;
           display: flex;
           align-items: flex-start;
         }
         .log-entry .timestamp {
           color: #999;
           padding-right: 8px;
           flex-shrink: 0;
         }
         .log-entry .message {
           flex: 1;
           word-break: break-word;
         }
         .log-entry.info .message {
           color: #6ec8ff;
         }
         .log-entry.error .message {
           color: #ff453a;
         }
         .log-entry.success .message {
           color: #32d74b;
         }
         .log-entry.warning .message {
           color: #ffd60a;
         }
         .log-entry.system .message {
           color: #f0a830;
           font-weight: 500;
         }
       `;
       document.head.appendChild(style);
       document.body.appendChild(this.container);
       
       // Add event listeners
       this.container.querySelector('.log-close-btn').addEventListener('click', () => {
         this.hide();
       });
       
       this.container.querySelector('.log-clear-btn').addEventListener('click', () => {
         this.clear();
       });
       
       return this.container;
     },
     
     show() {
       this.init();
       this.container.classList.remove('hidden');
     },
     
     hide() {
       if (this.container) {
         this.container.classList.add('hidden');
       }
     },
     
     toggle() {
       this.init();
       this.container.classList.toggle('hidden');
     },
     
     clear() {
       this.logs = [];
       if (this.container) {
         const content = this.container.querySelector('.log-content');
         if (content) content.innerHTML = '';
       }
     },
     
     add(message, type = 'info') {
       const timestamp = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
       
       // Create log entry object
       const entry = {
         timestamp,
         message,
         type
       };
       
       // Add to log array
       this.logs.push(entry);
       if (this.logs.length > this.maxLogs) {
         this.logs.shift();
       }
       
       // Update UI if container exists
       if (this.container) {
         const content = this.container.querySelector('.log-content');
         if (content) {
           const logEntry = document.createElement('div');
           logEntry.className = `log-entry ${type}`;
           logEntry.innerHTML = `
             <span class="timestamp">${timestamp}</span>
             <span class="message">${message}</span>
           `;
           content.appendChild(logEntry);
           content.scrollTop = content.scrollHeight;
         }
       }
       
       // Also log to console
       console.log(`[SnapPhil ${type}] ${message}`);
        // Mirror to canvas dial if present
        try {
          if (typeof window.__snapphilPushDialLog === 'function') {
            window.__snapphilPushDialLog({ ts: timestamp, chan: `SnapPhil ${type}`, msg: message });
          }
        } catch (_) {}
       
       return entry;
     },
     
     info(message) { return this.add(message, 'info'); },
     error(message) { return this.add(message, 'error'); },
     success(message) { return this.add(message, 'success'); },
     warning(message) { return this.add(message, 'warning'); },
     system(message) { return this.add(message, 'system'); }
   };

    // ==============================================
    // Canvas Live Logs Dial (replaces slider + terminal)
    // ==============================================
    const canvasDial = {
      initialized: false,
      container: null,
      canvas: null,
      ctx: null,
      statusEl: null,
      leftBtn: null,
      rightBtn: null,
      shield: null,
      _prevOverflow: '',
      logs: [],
      autoFollow: true,
      paused: false,
      W: 900,
      H: 360,
      COLS: 1,
      colW: 900,
      itemH: 46,
      DPR: Math.max(1, Math.min(2, window.devicePixelRatio || 1)),
      wheel: null,
      // Drag handling for moving the window
      draggingWindow: false,
      dragOffsetX: 0,
      dragOffsetY: 0,
      gravityStrength: 0.08,
      snapStrength: 0.18,
      levelColors: {
        'SnapPhil info': '#9aa7b9',
        'SnapPhil success': '#22c55e',
        'SnapPhil system': '#60a5fa',
        'SnapPhil error': '#ef4444'
      },
      ensure() {
        if (this.initialized) return this.container;
        const container = document.createElement('div');
        container.id = 'snapphil-canvas-dial';
        container.style.cssText = `
          position: fixed; bottom: 40vh; right: 24px; left: auto; transform: none;
          z-index: 2147483646; border-radius: 0px; overflow: hidden;
          background: rgba(255, 255, 255, 0);
          box-shadow: none;
          backdrop-filter: none;
          -webkit-backdrop-filter: none;
        `;
        const frame = document.createElement('div');
        frame.className = 'frame';
        frame.style.cssText = 'width:min(520px,90vw); border-radius:20px; overflow:hidden; background:transparent; position:relative;';
        const canvas = document.createElement('canvas'); canvas.id='dial'; canvas.width=900; canvas.height=360; canvas.setAttribute('aria-label','Live logs dial'); canvas.setAttribute('role','img'); canvas.style.cssText='display:block;width:100%;height:auto;touch-action:none;background:transparent;pointer-events:none;';
        frame.append(canvas);
        
        // Transparent blocker over the dial content to disable interactions with the wheel
        const dialBlocker = document.createElement('div');
        dialBlocker.className = 'dial-interaction-blocker';
        dialBlocker.style.cssText = 'position:absolute; left:0; right:0; top:18px; bottom:0; background:transparent; z-index:2;';
        const stopAll = (e)=>{ e.preventDefault(); e.stopPropagation(); };
        ['pointerdown','pointermove','pointerup','click','dblclick','wheel','touchstart','touchmove','contextmenu'].forEach(evt=>{
          try { dialBlocker.addEventListener(evt, stopAll, { passive:false, capture:true }); } catch(_) {}
        });
        frame.appendChild(dialBlocker);
        
        container.appendChild(frame);
        // No full-page shield; we only block interactions on the dial area itself
        // Invisible drag handle at the top to move the window
        const handle = document.createElement('div');
        handle.className = 'dial-drag-handle';
        handle.style.cssText = 'position:absolute;top:0;left:0;right:0;height:18px;cursor:grab;touch-action:none;display:flex;align-items:center;justify-content:center;';
        // Hide visual grip for a seamless chip without any line, while keeping the drag area active
        const grip = document.createElement('div');
        grip.setAttribute('aria-label','Drag');
        grip.style.cssText = 'display:none;';
        handle.appendChild(grip);
        container.appendChild(handle);
        const style = document.createElement('style');
        style.textContent = `
          #snapphil-canvas-dial{ 
            --accent:#2ea0ff; --ink:#ffffff; --muted:#8ea0ba; color:var(--ink);
            font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial;
          }
          #snapphil-canvas-dial canvas{
            -webkit-mask-image: none;
            mask-image: none;
          }
        `;
        document.head.appendChild(style); document.body.appendChild(container);
        this.container=container; this.canvas=canvas; this.ctx=canvas.getContext('2d',{alpha:true}); this.statusEl=null; this.leftBtn=null; this.rightBtn=null;
        const self=this; function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
        function ellipsize(ctx, text, maxW){ if (ctx.measureText(text).width <= maxW) return text; const ell='…'; let lo=0, hi=text.length; while(lo<hi){ const mid=(lo+hi+1)>>1; const s=text.slice(0,mid)+ell; if(ctx.measureText(s).width<=maxW) lo=mid; else hi=mid-1; } return text.slice(0,lo)+ell; }
        self.stripEmoji = (s) => (s||'').replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '');

        // Drag events to reposition the floating window anywhere
        const onHandleDown = (e) => {
          self.draggingWindow = true;
          // cancel any running entrance animation so it doesn't snap back
          try { container.getAnimations().forEach(a => a.cancel()); } catch(_) {}
          // Ensure centering transform doesn't interfere with first move bounds
          try { container.style.transform = ''; } catch(_) {}
          const rect = container.getBoundingClientRect();
          self.dragOffsetX = e.clientX - rect.left;
          self.dragOffsetY = e.clientY - rect.top;
          try { container.setPointerCapture(e.pointerId); } catch(_) {}
          e.preventDefault();
          container.style.cursor = 'grabbing';
        };
        const onContainerMove = (e) => {
          if (!self.draggingWindow) return;
          const rect = container.getBoundingClientRect();
          // Use innerWidth/innerHeight to include scrollbar width and avoid a right-side "wall"
          const vw = window.innerWidth || document.documentElement.clientWidth;
          const vh = window.innerHeight || document.documentElement.clientHeight;
          const margin = 4; // tighter margin from edges
          const maxLeft = vw - rect.width - margin;
          const maxTop = vh - rect.height - margin;
          let newLeft = e.clientX - self.dragOffsetX;
          let newTop = e.clientY - self.dragOffsetY;
          newLeft = clamp(newLeft, margin, maxLeft);
          newTop = clamp(newTop, margin, maxTop);
          container.style.left = Math.round(newLeft) + 'px';
          container.style.top = Math.round(newTop) + 'px';
          container.style.bottom = '';
          container.style.transform = '';
          e.preventDefault();
        };
        const onHandleUp = (e) => {
          self.draggingWindow = false;
          try { container.releasePointerCapture(e.pointerId); } catch(_) {}
          container.style.cursor = 'grab';
        };
        handle.addEventListener('pointerdown', onHandleDown, { passive: false });
        container.addEventListener('pointermove', onContainerMove, { passive: false });
        window.addEventListener('pointermove', onContainerMove, { passive: false });
        container.addEventListener('pointerup', onHandleUp);
        container.addEventListener('pointercancel', onHandleUp);
        window.addEventListener('pointerup', onHandleUp);
         class Wheel{ constructor(getItems, initialIndex){ this.getItems=getItems; this.items=getItems(); this.pos=clamp(initialIndex,0,Math.max(0,this.items.length-1)); this.vel=0; this.dragging=false; this.pointerId=null; this.lastY=0; this.lastPos=this.pos; this.target=null; this.min=0; this.max=Math.max(0,this.items.length-1);} refresh(){ this.items=this.getItems(); this.max=Math.max(0,this.items.length-1); this.pos=clamp(this.pos,this.min,this.max); if(this.target!==null) this.target=clamp(this.target,this.min,this.max);} get selectedIndex(){ return clamp(Math.round(this.pos), this.min, this.max);} onDown(id,x,y){ this.dragging=true; this.pointerId=id; this.lastY=y; this.vel=0; this.target=null; this.lastPos=this.pos; return true;} onMove(id,x,y){ if(!this.dragging||id!==this.pointerId) return; let dy=(y-this.lastY)/self.itemH; if(this.pos<this.min&&dy>0) dy*=.3; if(this.pos>this.max&&dy<0) dy*=.3; this.pos-=dy; this.lastY=y; this.vel=this.pos-this.lastPos; this.lastPos=this.pos;} onUp(id){ if(id!==this.pointerId) return; this.dragging=false; this.pointerId=null; this.snap(); } snap(){ this.target=clamp(Math.floor(this.pos + 0.25), this.min, this.max);} step(dt){ this.refresh(); if(!this.dragging){ this.pos+=this.vel*dt; this.vel*=Math.pow(0.95,dt); if (!self.autoFollow) { this.vel += (self.max - self.pos) * self.gravityStrength * dt; } if(this.pos<this.min||this.pos>this.max){ const b=this.pos<this.min?this.min:this.max; const diff=b-this.pos; this.vel+=diff*0.10*dt; this.vel*=Math.pow(0.88,dt);} const nearest=clamp(Math.floor(this.pos + 0.25),this.min,this.max); const diffN=nearest-this.pos; if(Math.abs(diffN)<0.25){ this.vel+=diffN*self.snapStrength*dt; this.vel*=Math.pow(0.90,dt);} if(this.target===null && Math.abs(this.vel)<0.01){ this.snap(); } if(this.target!==null){ const diff=this.target-this.pos; this.vel+=diff*0.18*dt; this.vel*=Math.pow(0.90,dt); if(Math.abs(diff)<0.01 && Math.abs(this.vel)<0.01){ this.pos=this.target; this.vel=0; this.target=null; } } } } draw(ctx){ const cssW=self.W/self.DPR, cssH=self.H/self.DPR; const midY = Math.round(cssH * 0.70); ctx.save(); ctx.beginPath(); ctx.rect(0,0,self.colW,cssH); ctx.clip(); const n=this.items.length; const visible=Math.ceil((cssH/self.itemH)+2); const centerIndex=this.pos; const start=Math.max(0, Math.floor(centerIndex - visible)); const end=Math.min(n-1, Math.ceil(centerIndex + visible)); const selIndex=this.selectedIndex; for(let i=start;i<=end;i++){ const d=i-centerIndex; const y=midY + d*self.itemH; const sel=(i===selIndex); // opacity curve like picker
            const t = Math.min(1, Math.abs(d)/3);
            const fade = 1 - t*t; // quadratic ease-out
            const entry=this.items[i]||{}; const raw=String(entry.msg||''); const msg=self.stripEmoji(raw);
            ctx.textAlign='center'; ctx.textBaseline='middle'; const x=self.colW/2; const msgSize=sel?Math.round(self.itemH*0.46):Math.round(self.itemH*0.40*fade + 14*(1-fade));
            // Only the focused row is bold; all others are regular weight
            ctx.font=`${sel?800:400} ${msgSize}px -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial`;
            // Blue text color; keep opacity curve for non-selected rows
            const baseAlpha = sel ? 1 : (0.65*fade + 0.10);
            ctx.fillStyle = `rgba(46,160,255,${baseAlpha})`;
            const msgText=ellipsize(ctx, msg, self.colW*0.9);
            ctx.fillText(msgText, x, y);
          }
          ctx.restore(); }
        }
        this.W = 680 * this.DPR; this.H = 300 * this.DPR; this.canvas.width=this.W; this.canvas.height=this.H; this.canvas.style.width='min(680px,92vw)'; this.canvas.style.height='auto';
        this.colW = Math.min(680, frame.clientWidth);
        const resize = () => {
          const cssW = Math.min(600, frame.clientWidth);
          const baseH = Math.max(170, Math.min(240, Math.round(cssW * 0.24))); // base height
          const cssH = Math.max(120, Math.round(baseH * 0.70)); // reduce overall height by ~30%
          this.W = Math.round(cssW * this.DPR);
          this.H = Math.round(cssH * this.DPR);
          this.canvas.width = this.W; this.canvas.height = this.H;
          this.canvas.style.width = cssW + 'px'; this.canvas.style.height = cssH + 'px';
          this.ctx.setTransform(this.DPR,0,0,this.DPR,0,0);
          this.COLS = 1; this.colW = cssW / this.COLS; this.itemH = Math.max(36, Math.min(54, Math.round(cssH/6.2)));
        };
        window.addEventListener('resize', resize); resize();
        const logs=this.logs; this.wheel = new Wheel(()=>logs, Math.max(0, logs.length-1));
        const disengageFollow = () => { this.paused = true; this.autoFollow = false; };
        // Disable direct wheel interactions inside the dial; movement is read-only visual now
        // All pointer/wheel listeners on canvas are removed or no-ops
        // Smooth show/hide animations; ensure we don't fight with dragging.
        container.style.transform = 'translateY(0)';
        const intro = container.animate([
          { transform: 'translateY(20px)', opacity: 0 },
          { transform: 'translateY(0)', opacity: 1 }
        ], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' });
        // No topbar controls; free scroll and auto-follow are handled via pointer/wheel interaction.
        let last=performance.now(); const tick=(now)=>{ const dt=(now-last)/16.6667; last=now; this.wheel.step(dt); this.draw(); requestAnimationFrame(tick); }; requestAnimationFrame(tick);
        const pad2 = n => n<10? ('0'+n) : ''+n;
        this.pushLog = (entry)=>{ const e={...entry}; if(!e.ts){ const d=new Date(); e.ts=`${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3,'0')}`; } logs.push(e); this.wheel.refresh(); const lastIdx=logs.length-1; if(this.autoFollow){ this.wheel.pos=lastIdx; this.wheel.vel=0; this.wheel.target=lastIdx; } };
        window.__snapphilPushDialLog = (e)=> this.pushLog(e);
        this.initialized = true; return this.container;
      },
      draw(){
        if(!this.initialized) return;
        const ctx=this.ctx; const cssW=this.W/this.DPR, cssH=this.H/this.DPR;
        ctx.clearRect(0,0,cssW,cssH);
        // Draw logs without any extra gradients/masks
        this.wheel.draw(ctx);
      },
      show(){ this.ensure(); if(this.container){ this.container.style.display='block'; } },
      hide(){ if(this.container){ this.container.style.display='none'; } }
   };

    // ==============================================
    // Field Results Summary Panel (glassmorphism)
    // ==============================================
    function showFieldResultsPanel(fieldResults, totalPlannedActions) {
      try {
        const existing = document.getElementById('snapphil-results-panel');
        if (existing) existing.remove();

        const panel = document.createElement('div');
        panel.id = 'snapphil-results-panel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', 'Autofill Summary');
        panel.style.cssText = `
          position: fixed; right: 24px; bottom: 10vh; z-index: 2147483646;
          min-width: 320px; max-width: 460px; color: #e9f2ff;
          background: rgba(20,22,26,0.55);
          backdrop-filter: blur(12px) saturate(120%);
          -webkit-backdrop-filter: blur(12px) saturate(120%);
          border: 1px solid rgba(255,255,255,0.08);
          box-shadow: 0 18px 60px rgba(0,0,0,0.35);
          border-radius: 16px; overflow: hidden; font-family: -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial;
        `;

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:rgba(255,255,255,0.04);font-weight:600;';
        header.textContent = 'Autofill summary';

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '×';
        closeBtn.setAttribute('aria-label','Close');
        closeBtn.style.cssText = 'margin-left:12px;background:none;border:none;color:#cfe4ff;font-size:18px;cursor:pointer;line-height:1;';
        closeBtn.onclick = () => panel.remove();
        header.appendChild(closeBtn);

        const body = document.createElement('div');
        body.style.cssText = 'padding:12px 14px;max-height:260px;overflow:auto;';

        // Helper to ignore filler/wrong-name fields from summary and calculations
        const shouldIgnoreFieldResult = (id, info) => {
          const label = String((info && info.label) || '');
          const error = String((info && info.error) || '');
          const idStr = String(id || '');
          const isQuestionKey = /^question_\d+(?:\[\])?$/i.test(idStr);
          const isElementNotFoundQuestion = error === 'Element not found' && /^question_\d+/i.test(idStr);
          const isGenericEmptyFormField = error === 'Field appears empty' && (label === '' || label === 'Form Field');
          return isQuestionKey || isElementNotFoundQuestion || isGenericEmptyFormField;
        };

        // Only show incomplete items in the checklist view, excluding ignored ones
        const allEntriesRaw = Object.entries(fieldResults || {});
        const allEntries = allEntriesRaw.filter(([id, v]) => !shouldIgnoreFieldResult(id, v));
        const entries = allEntries.filter(([,v]) => v && v.status !== 'success');
        const successes = allEntries.filter(([,v]) => v && v.status === 'success').length;
        const failures = allEntries.filter(([,v]) => v && v.status === 'error').length;
        const totalMeasured = Math.max(1, successes + failures);
        const remaining = Math.max(0, totalMeasured - successes);
        const pct = Math.round((successes / totalMeasured) * 100);

        const summary = document.createElement('div');
        summary.style.cssText = 'display:flex;gap:10px;align-items:center;margin-bottom:10px;';
        summary.innerHTML = `
          <div style="flex:1">
            <div style="font-size:14px;font-weight:600">Completed: ${successes}/${totalMeasured} (${pct}%)</div>
            <div style="font-size:12px;color:#b9cbe6">Remaining: ${remaining} • Failed: ${failures}</div>
          </div>
          <div style="width:90px;height:6px;background:rgba(255,255,255,0.12);border-radius:6px;overflow:hidden">
            <div style="width:${pct}%;height:100%;background:#2ea0ff"></div>
          </div>
        `;
        body.appendChild(summary);

        const list = document.createElement('div');
        list.style.cssText = 'display:grid;grid-template-columns:1fr;gap:6px;';
        entries.forEach(([elementId, info]) => {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;gap:8px;align-items:center;background:rgba(255,255,255,0.03);padding:8px 10px;border-radius:10px;';
          const mark = document.createElement('span');
          mark.textContent = info.status === 'error' ? '✕' : '…';
          mark.style.cssText = `font-weight:700;color:${info.status==='error'?'#ef4444':'#f0a830'};`;
          const label = document.createElement('div');
          label.style.cssText = 'flex:1;min-width:0;';
          const name = String(info.label || elementId || '');
          const nameDiv = document.createElement('div');
          nameDiv.style.cssText = 'font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
          nameDiv.textContent = name; // textContent prevents unintended HTML rendering
          label.appendChild(nameDiv);
          if (info.status === 'error' && info.error) {
            const errDiv = document.createElement('div');
            errDiv.style.cssText = 'font-size:11px;color:#ffb4b4';
            errDiv.textContent = String(info.error);
            label.appendChild(errDiv);
          }
          row.appendChild(mark); row.appendChild(label);
          list.appendChild(row);
        });
        body.appendChild(list);

        panel.appendChild(header);
        panel.appendChild(body);
        document.body.appendChild(panel);
        return panel;
      } catch (_) { /* no-op */ }
      return null;
    }

   // Inject FontAwesome if not already present
   if (!document.querySelector('link[href*="font-awesome"]')) {
     // Instead of loading from CDN which causes CSP issues, create elements with classes
     console.log("Adding FontAwesome icons using CSS classes instead of CDN");
     
     // Add a style element with basic icon styles to simulate FontAwesome
     const iconStyles = document.createElement('style');
     iconStyles.textContent = `
       /* Basic icon styles to replace FontAwesome for essential functions */
       .status-card-icon i {
         font-family: Arial, sans-serif;
         line-height: 1;
         font-weight: normal;
         font-style: normal;
       }
       .fa-circle-notch:before { content: "⭮"; }
       .fa-spin:before { content: "⟳"; }
       .fa-magnifying-glass:before { content: "🔍"; }
       .fa-robot:before { content: "🤖"; }
       .fa-brain:before { content: "🧠"; }
       .fa-pen:before, .fa-pen-to-square:before { content: "✏️"; }
       .fa-paper-plane:before { content: "📤"; }
       .fa-bolt:before { content: "⚡"; }
       .fa-circle:before { content: "⬤"; }
       .fa-check:before { content: "✓"; }
       .fa-xmark:before { content: "✕"; }
       .fa-exclamation:before { content: "❗"; }
       .fa-eraser:before { content: "🧹"; }
       .fa-times:before { content: "✖️"; }
       .fa-rocket:before { content: "🚀"; }
       .fa-search:before { content: "🔎"; }
     `;
     document.head.appendChild(iconStyles);
   }

   // Application state to track execution
   let applicationState = {
     detectedElements: null,
     actionHistory: [],
     isProcessing: false,
     currentStep: 0,
     currentAction: null,
     tokenUsage: 0,
     currentAIResponse: null
   };

   // Create a simple status window container for tracking application status
   function createStatusWindow() {
     if (document.querySelector('.snapphil-status-window')) {
       return document.querySelector('.snapphil-status-window');
     }
     
     const statusWindow = document.createElement('div');
     statusWindow.className = 'snapphil-status-window';
     document.body.appendChild(statusWindow);
     return statusWindow;
   }
   
   // Helper function to get cover letter settings from storage
   function getCoverLetterSettings() {
     return new Promise((resolve) => {
       chrome.storage.local.get(['coverLetterSettings'], (result) => {
         resolve(result.coverLetterSettings || null);
       });
     });
   }

   function createSlidingStatusWindow() {
      return canvasDial.ensure();
   }

   function createStatusCard(id, iconName, label) {
     const card = document.createElement('div');
     card.className = 'status-card';
     card.dataset.id = id;
     card.dataset.label = label || '';
     
     if (!iconName) {
       // Default icon if none provided
       iconName = 'circle';
     }
     
     const icon = document.createElement('div');
     icon.className = 'status-card-icon';
     
     // Create the icon element properly
     const iconElement = document.createElement('i');
     iconElement.className = 'fas'; // Base FontAwesome class
     
     // Add the icon classes (removing 'fa-' prefix if present)
     const iconClasses = iconName.split(' ');
     iconClasses.forEach(cls => {
       if (cls.startsWith('fa-')) {
         iconElement.classList.add(cls);
       } else {
         iconElement.classList.add(`fa-${cls}`);
       }
     });
     
     icon.appendChild(iconElement);
     card.appendChild(icon);
     
     return card;
   }

   let cardPositions = [];
   function calculateCardPositions() {
     const slider = document.getElementById('ai-job-assistant-slider');
     if (!slider) return;
     
     const cardsTrack = slider.querySelector('.cards-track');
     if (!cardsTrack) return;
     
     const cards = cardsTrack.querySelectorAll('.status-card');
     if (!cards.length) return;
     
     const currentTransform = cardsTrack.style.transform;
     cardsTrack.style.transform = 'none';
     
     cardPositions = Array.from(cards).map(card => {
       return card.offsetLeft + (card.offsetWidth / 2);
     });
     
     cardsTrack.style.transform = currentTransform;
   }
   
    function showSlidingWindow() { canvasDial.show(); }
   
    function hideSlidingWindow() { canvasDial.hide(); }
   
   function centerCardInWindow(statusId) {
     const slider = document.getElementById('ai-job-assistant-slider');
     if (!slider) return;
     
     const cardsTrack = slider.querySelector('.cards-track');
     if (!cardsTrack) return;
     
     const cards = cardsTrack.querySelectorAll('.status-card');
     if (!cards.length) return;
     
     if (cardPositions.length === 0) {
       calculateCardPositions();
     }
     
     let targetIndex = -1;
     let targetCard = null;
     cards.forEach((card, index) => {
       if (card.dataset.id === statusId) {
         targetIndex = index;
         targetCard = card;
       }
     });
     if (targetIndex === -1) return;
     
     const cardsContainer = slider.querySelector('.cards-container');
     const containerWidth = cardsContainer ? cardsContainer.clientWidth : slider.clientWidth;
     const targetPosition = cardPositions[targetIndex];
     const translateX = (containerWidth / 2) - targetPosition;
     
     cardsTrack.style.transform = `translateX(${translateX}px)`;
     
     // Update the label container with the focused card's label
     const cardLabelContainer = slider.querySelector('.card-label-container');
     if (cardLabelContainer && targetCard) {
       cardLabelContainer.textContent = targetCard.dataset.label || '';
     }
     
     cards.forEach((card, index) => {
       card.classList.remove('active', 'adjacent', 'distant');
       if (index === targetIndex) {
         card.classList.add('active'); // 100% brightness
       } else if (index < targetIndex) {
         card.classList.add('completed');
       }
       
       // Add classes for adjacent (dimmed) and distant (more dimmed) cards
       const distance = Math.abs(index - targetIndex);
       if (distance === 1) {
         card.classList.add('adjacent'); // ~50% brightness
       } else if (distance > 1) {
         card.classList.add('distant'); // ~40% brightness
       }
     });
   }
   
   function updateSlidingWindowStatus(statusId, message = null, progress = null, type = 'progress') {
       const msg = message || statusId || '';
       try { canvasDial.ensure(); canvasDial.pushLog({ msg }); } catch(_) {}
   }
   
   function getStatusIndex(statusId) {
     const statuses = ['init', 'detect', 'analyze', 'fill', 'submit'];
     return statuses.indexOf(statusId);
   }
   
    function addStatus(id, icon, label, position = 'end') { /* replaced by dial */ }
   
   function updateTokenUsage(tokenCount = 0) {
     const tokenCounter = document.getElementById('token-usage-count');
     if (tokenCounter) {
       tokenCounter.textContent = tokenCount.toLocaleString();
       
       // Update application state
       applicationState.tokenUsage = tokenCount;
       
       // Store token usage in storage
       chrome.storage.local.get(['tokenUsage'], (result) => {
         const currentTotal = result.tokenUsage || 0;
         chrome.storage.local.set({ tokenUsage: currentTotal + tokenCount });
       });
     }
   }
   
   function showSlidingStatus(message, type = 'info', progress = null, statusId = null) {
     if (!statusId) {
       switch (type) {
         case 'info':
           statusId = 'init';
           break;
         case 'progress':
           statusId = progress < 30 ? 'detect' : progress < 60 ? 'analyze' : 'fill';
           break;
         case 'success':
           statusId = 'submit';
           break;
         case 'error':
           statusId = 'detect';
           break;
         default:
           statusId = 'init';
       }
     }
     
     if (!document.getElementById('ai-job-assistant-slider') ||
         document.getElementById('ai-job-assistant-slider').classList.contains('hidden')) {
       showSlidingWindow();
     }
     
     updateSlidingWindowStatus(statusId, message, progress, type);
     
     // If we received a response with token usage, update the display
     if (applicationState.tokenUsage > 0) {
       updateTokenUsage(applicationState.tokenUsage);
     }
     
     if (type === 'success' && statusId === 'submit') {
       setTimeout(() => {
         hideSlidingWindow();
         
         // Show mini status instead
         const miniStatus = createMiniStatusWindow();
         const miniText = miniStatus.querySelector('.mini-status-text');
         if (miniText) miniText.textContent = 'Form Filled Successfully';
         
         const miniIcon = miniStatus.querySelector('.mini-status-icon i');
         if (miniIcon) {
           miniIcon.className = 'fas fa-check';
           miniIcon.style.color = '#32d74b';
         }
       }, 5000);
     } else if (type === 'error') {
       // For errors, keep the main window open but also show mini status
       const miniStatus = createMiniStatusWindow();
       const miniText = miniStatus.querySelector('.mini-status-text');
       if (miniText) miniText.textContent = 'Error';
       
       const miniIcon = miniStatus.querySelector('.mini-status-icon i');
       if (miniIcon) {
         miniIcon.className = 'fas fa-exclamation';
         miniIcon.style.color = '#ff453a';
       }
     }
     
     chrome.runtime.sendMessage({
       action: 'updateStatus',
       message: message,
       type: type,
       progress: progress,
       currentAction: statusId
     }).catch(error => {
       console.log("No active popup to update");
     });
   }
   
   function createStatusNotification() {
     if (document.getElementById('ai-job-assistant-notification')) {
       return document.getElementById('ai-job-assistant-notification');
     }
     
     const notification = document.createElement('div');
     notification.id = 'ai-job-assistant-notification';
     notification.className = 'ai-job-assistant-notification hidden';
     
     notification.innerHTML = `
       <div class="notification-content">
         <div class="notification-icon"></div>
         <div class="notification-message">Ready</div>
         <button class="notification-close">&times;</button>
       </div>
     `;
     
     const style = document.createElement('style');
     style.textContent = `
       .ai-job-assistant-notification {
         position: fixed;
         bottom: 20px;
         right: 20px;
         z-index: 10000;
         max-width: 350px;
         background-color: rgba(42, 45, 57, 0.95);
         color: #e3e3e3;
         border-radius: 8px;
         box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
         transition: all 0.3s ease;
         overflow: hidden;
         font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif;
       }
       .ai-job-assistant-notification.hidden {
         opacity: 0;
         transform: translateY(30px);
         pointer-events: none;
       }
       .notification-content {
         display: flex;
         align-items: center;
         padding: 12px 16px;
       }
       .notification-icon {
         width: 16px;
         height: 16px;
         border-radius: 50%;
         margin-right: 12px;
         background-color: #f0a830;
       }
       .notification-icon.success {
         background-color: #32d74b;
       }
       .notification-icon.error {
         background-color: #ff453a;
       }
       .notification-icon.warning {
         background-color: #ffd60a;
       }
       .notification-icon.info {
         background-color: #0a84ff;
       }
       .notification-message {
         flex: 1;
         font-size: 14px;
       }
       .notification-close {
         background: none;
         border: none;
         color: rgba(255, 255, 255, 0.6);
         font-size: 18px;
         cursor: pointer;
         padding: 0 0 0 8px;
       }
       .progress-bar {
         height: 4px;
         width: 100%;
         background-color: rgba(255, 255, 255, 0.1);
       }
       .progress-fill {
         height: 100%;
         width: 0%;
         background-color: #f0a830;
         transition: width 0.3s ease;
       }
       .notification-icon.progress {
         animation: pulse 1.5s infinite;
       }
       @keyframes pulse {
         0% { opacity: 0.6; }
         50% { opacity: 1; }
         100% { opacity: 0.6; }
       }
     `;
     
     document.head.appendChild(style);
     document.body.appendChild(notification);
     
     const closeBtn = notification.querySelector('.notification-close');
     closeBtn.addEventListener('click', function() {
       notification.classList.add('hidden');
     });
     
     return notification;
   }

   function showNotification(message, type = 'info', progress = null, currentAction = null) {
     showSlidingStatus(message, type, progress, currentAction);
   }

   function detectFormElements() {
     console.log("Detecting form elements...");
     showSlidingStatus("Detecting form elements on the page...", "progress", 10, "detect");
     
     const elements = {
       textInputs: [],
       textareas: [],
       selects: [],
       checkboxes: [],
       radioGroups: {},
       fileInputs: [],
       buttons: []
     };
     
     document.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input[type="password"], input:not([type])').forEach((input, index) => {
       const id = input.id || input.name || `text-input-${index}`;
       const labelText = getLabelText(input);
       const placeholder = input.placeholder || '';
       
       elements.textInputs.push({
         id: id,
         domId: input.id || '',
         name: input.name || '',
         type: input.type || 'text',
         labelText: labelText,
         placeholder: placeholder,
         required: input.required,
         value: input.value,
         domElement: input
       });
     });
     
     document.querySelectorAll('textarea').forEach((textarea, index) => {
       const id = textarea.id || textarea.name || `textarea-${index}`;
       const labelText = getLabelText(textarea);
       const placeholder = textarea.placeholder || '';
       
       elements.textareas.push({
         id: id,
         domId: textarea.id || '',
         name: textarea.name || '',
         labelText: labelText,
         placeholder: placeholder,
         required: textarea.required,
         value: textarea.value,
         domElement: textarea
       });
     });
     
      document.querySelectorAll('select').forEach((select, index) => {
       const id = select.id || select.name || `select-${index}`;
       const labelText = getLabelText(select);
       const options = Array.from(select.options).map(option => ({
         value: option.value,
         text: option.text,
         selected: option.selected
       }));
       
       elements.selects.push({
         id: id,
         domId: select.id || '',
         name: select.name || '',
         labelText: labelText,
         required: select.required,
         options: options,
          value: select.value,
          // Include additional metadata some APIs require
          dataset: { ...select.dataset },
          aria: {
            role: select.getAttribute('role') || '',
            controls: select.getAttribute('aria-controls') || '',
            expanded: select.getAttribute('aria-expanded') || ''
          },
         domElement: select
       });
     });
     
     document.querySelectorAll('input[type="checkbox"]').forEach((checkbox, index) => {
       const id = checkbox.id || checkbox.name || `checkbox-${index}`;
       const labelText = getLabelText(checkbox);
       
       elements.checkboxes.push({
         id: id,
         domId: checkbox.id || '',
         name: checkbox.name || '',
         labelText: labelText,
         required: checkbox.required,
         checked: checkbox.checked,
         value: checkbox.value,
         domElement: checkbox
       });
     });
     
     document.querySelectorAll('input[type="radio"]').forEach((radio) => {
       const name = radio.name;
       if (!name) return;
       if (!elements.radioGroups[name]) {
         elements.radioGroups[name] = {
           name: name,
           labelText: getGroupLabelText(radio),
           options: []
         };
       }
       elements.radioGroups[name].options.push({
         id: radio.id || `radio-${name}-${elements.radioGroups[name].options.length}`,
         domId: radio.id || '',
         value: radio.value,
         labelText: getLabelText(radio),
         checked: radio.checked,
         domElement: radio
       });
     });
     
     document.querySelectorAll('input[type="file"]').forEach((fileInput, index) => {
       const id = fileInput.id || fileInput.name || `file-input-${index}`;
       const labelText = getLabelText(fileInput);
       
       elements.fileInputs.push({
         id: id,
         domId: fileInput.id || '',
         name: fileInput.name || '',
         labelText: labelText,
         required: fileInput.required,
         accept: fileInput.accept || '',
         domElement: fileInput
       });
     });
     
     document.querySelectorAll('button, input[type="button"], input[type="submit"]').forEach((button, index) => {
       const id = button.id || button.name || `button-${index}`;
       const text = button.textContent || button.value || '';
       const type = button.type || (button.tagName === 'BUTTON' ? 'button' : '');
       
       elements.buttons.push({
         id: id,
         domId: button.id || '',
         name: button.name || '',
         type: type,
         text: text.trim(),
         value: button.value || '',
         domElement: button
       });
     });
     
     const radioGroupsArray = Object.values(elements.radioGroups);
     elements.radioGroups = radioGroupsArray;
     
     console.log("Detected elements:", elements);
     
     showSlidingStatus("Form elements detected successfully", "success", 100, "detect");
     
     return elements;
   }

   function getLabelText(element) {
     let labelText = '';
     if (element.id) {
       const label = document.querySelector(`label[for="${element.id}"]`);
       if (label) {
         labelText = label.textContent.trim();
       }
     }
     if (!labelText && element.parentElement && element.parentElement.tagName === 'LABEL') {
       labelText = element.parentElement.textContent.trim();
       if (element.type === 'checkbox' || element.type === 'radio') {
         labelText = labelText.replace(element.value, '').trim();
       }
     }
     return labelText;
   }

   function getGroupLabelText(radioElement) {
     let container = radioElement.closest('fieldset, div, form');
     if (container) {
       const legendOrLabel = container.querySelector('legend, label, div[class*="label"], div[class*="title"], h3, h4, p strong');
       if (legendOrLabel) {
         return legendOrLabel.textContent.trim();
       }
       const prevElement = container.previousElementSibling;
       if (prevElement && (prevElement.tagName === 'LABEL' || prevElement.tagName === 'DIV' || prevElement.tagName === 'P' || prevElement.tagName === 'SPAN')) {
         return prevElement.textContent.trim();
       }
     }
     return '';
   }

   function getPageText() {
     let mainContent = document.querySelector('main') ||
                       document.querySelector('.main-content') ||
                       document.querySelector('#content') ||
                       document.querySelector('.content') ||
                       document.body;
     const headings = Array.from(mainContent.querySelectorAll('h1, h2, h3, h4, h5, h6, p'));
     return headings.map(el => el.textContent.trim()).join('\n');
   }

   // Function to generate PDF from text content
   function generatePDFFromText(text, filename) {
     return new Promise(async (resolve, reject) => {
       try {
         console.log("Starting PDF generation process...");
         
         // Make sure required libraries are loaded
         await loadRequiredLibraries();
         
         // Check if jsPDF is available
         if (typeof window.jspdf === 'undefined' && typeof jsPDF === 'undefined') {
           console.error("jsPDF not available - PDF generation not possible");
           throw new Error("PDF generation library not available");
         }
         
         let doc;
         try {
           if (typeof window.jspdf !== 'undefined') {
             console.log("Using jsPDF from window.jspdf");
             const { jsPDF } = window.jspdf;
             doc = new jsPDF();
           } else if (typeof jsPDF !== 'undefined') {
             console.log("Using jsPDF from global scope");
             doc = new jsPDF();
           } else {
             throw new Error("jsPDF not available");
           }
         } catch (jspdfError) {
           console.error("Error creating jsPDF instance:", jspdfError);
           throw new Error("Failed to initialize PDF generator");
         }
         
         console.log("PDF document created");
         
         // Set decent margins
         const margin = 20;
         const pageWidth = doc.internal.pageSize.getWidth();
         const pageHeight = doc.internal.pageSize.getHeight();
         const maxWidth = pageWidth - (margin * 2);
         
         console.log("Processing cover letter text...");
         
         // Add the content, split into paragraphs
         const paragraphs = text.split("\n\n");
         let yPos = margin;
         const lineHeight = 7;
         
         // Add title at the top
         doc.setFontSize(16);
         doc.setFont("helvetica", "bold");
         doc.text("Cover Letter", margin, yPos);
         yPos += lineHeight * 2;
         
         // Normal text formatting
         doc.setFontSize(11);
         doc.setFont("helvetica", "normal");
         
         // Process each paragraph
         paragraphs.forEach((paragraph, index) => {
           // Skip empty paragraphs
           if (!paragraph.trim()) return;
           
           console.log(`Processing paragraph ${index+1}/${paragraphs.length}`);
           
           // Split text to fit within margins
           const textLines = doc.splitTextToSize(paragraph, maxWidth);
           doc.text(textLines, margin, yPos);
           
           // Update position for next paragraph
           yPos += textLines.length * lineHeight + 5;
           
           // Add a new page if needed
           if (yPos > pageHeight - margin) {
             console.log("Adding new page");
             doc.addPage();
             yPos = margin;
           }
         });
         
         console.log("Generating data URL...");
         // Get PDF as data URL
         let dataUrl;
         try {
           dataUrl = doc.output('datauristring');
         } catch (outputError) {
           console.error("Error generating dataURL:", outputError);
           throw new Error("Could not generate PDF data URL");
         }
         console.log("PDF generation complete");
         
         resolve(dataUrl);
       } catch (error) {
         console.error("PDF generation failed:", error);
         // Instead of rejecting, return a simple error PDF so the flow can continue
         try {
           // Create a very simple PDF with error message
           const simplePdf = new jsPDF();
           simplePdf.setFontSize(16);
           simplePdf.text("Error generating cover letter", 20, 30);
           simplePdf.setFontSize(12);
           simplePdf.text("The system encountered an error creating your cover letter.", 20, 50);
           simplePdf.text("Please try again or create one manually.", 20, 60);
           simplePdf.text("Error: " + (error.message || "Unknown error"), 20, 80);
           
           // Return this simple PDF
           const fallbackUrl = simplePdf.output('datauristring');
           resolve(fallbackUrl);
         } catch (fallbackError) {
           // If even the fallback fails, reject with the original error
           reject(error);
         }
       }
     });
   }

   async function executeFormActions(actions) {
     console.log("Executing form actions:", actions);
     logSystem.system("Beginning form filling process");
     showSlidingStatus("Starting to fill form fields...", "progress", 0, "fill");
     
     // Enhanced validation and format correction
     try {
       // If actions is directly an array instead of having a formActions property
       if (Array.isArray(actions)) {
         actions = { formActions: actions, submitForm: true };
         logSystem.info("Converted actions array to proper format");
       }
       
       // If actions is a string (potentially JSON), try to parse it
       if (typeof actions === 'string') {
         try {
           actions = JSON.parse(actions);
           logSystem.info("Successfully parsed actions from string");
         } catch (parseError) {
           logSystem.error(`Failed to parse actions string: ${parseError.message}`);
           showSlidingStatus("Error: Could not parse actions data", "error");
           return false;
         }
       }
       
       // Check if we have valid actions
       if (!actions || typeof actions !== 'object') {
         logSystem.error("Invalid actions format: not an object");
         showSlidingStatus("Error: Invalid actions format received", "error");
         return false;
       }
       
       // Ensure formActions is an array
       if (!actions.formActions) {
         // Try to find actions under a different property
         const possibleActionArrays = Object.values(actions).find(val => Array.isArray(val));
         if (possibleActionArrays && possibleActionArrays.length > 0) {
           actions.formActions = possibleActionArrays;
           logSystem.info("Found actions array in different property, using it");
         } else {
           logSystem.error("No formActions array found in actions object");
           showSlidingStatus("Error: No actions found to execute", "error");
           return false;
         }
       }
       
       if (!Array.isArray(actions.formActions)) {
         logSystem.error("Invalid formActions format: not an array");
         showSlidingStatus("Error: Invalid actions format received from AI", "error");
         return false;
       }
       
       // Validate each action has the required fields
       const validActions = actions.formActions.filter(action => {
         return action && typeof action === 'object' && 
                action.elementId && 
                action.action && 
                (action.value !== undefined || action.action === 'click');
       });
       
       // Continue if we have at least some valid actions
       if (validActions.length === 0) {
         logSystem.error("No valid actions found in the response");
         showSlidingStatus("Error: No valid actions found to execute", "error");
         return false;
       }
       
       if (validActions.length < actions.formActions.length) {
         logSystem.warning(`Found ${validActions.length} valid actions out of ${actions.formActions.length} total`);
         // Replace the original actions with just the valid ones
         actions.formActions = validActions;
       }
     } catch (formatError) {
       logSystem.error(`Error processing actions format: ${formatError.message}`);
       showSlidingStatus("Error processing AI response", "error");
       return false;
     }
     
     if (actions.tokenUsage) {
       logSystem.info(`Token usage confirmed: ${actions.tokenUsage} tokens`);
       applicationState.tokenUsage = actions.tokenUsage;
     }
     
     const totalActions = actions.formActions.length;
     logSystem.info(`Preparing to execute ${totalActions} form actions`);
     let completedActions = 0;
     
      // Track per-field results
      let fieldResults = {};
     
     for (const action of actions.formActions) {
       try {
         logSystem.info(`Processing action: ${action.action} on "${action.elementId}"`);
         applicationState.currentAction = action;
         const progressPercent = Math.round(((completedActions + 0.5) / totalActions) * 100);
         
         let actionDescription;
         if (action.action === 'fill') {
           actionDescription = `Filling "${getLabelOrPlaceholder(action.elementId)}"`;
         } else if (action.action === 'select') {
           actionDescription = `Selecting option in "${getLabelOrPlaceholder(action.elementId)}"`;
         } else if (action.action === 'check') {
           actionDescription = `Checking "${getLabelOrPlaceholder(action.elementId)}"`;
         } else if (action.action === 'upload') {
           actionDescription = `Uploading ${action.value === "resumeFile" ? "resume" : "cover letter"}`;
         } else if (action.action === 'click') {
           actionDescription = `Clicking "${getButtonText(action.elementId)}"`;
         } else {
           actionDescription = `Processing "${action.elementId}"`;
         }
         
         logSystem.info(actionDescription + ": " + action.explanation);
         
         chrome.runtime.sendMessage({
           action: 'formAction',
           progress: progressPercent,
           action: actionDescription,
           explanation: action.explanation,
           elementId: action.elementId,
           type: "progress"
         }).catch(error => {
           console.log("No active popup to update field action");
         });
         
         showSlidingStatus(`${actionDescription}: ${action.explanation}`, "progress", progressPercent, "fill");
         await executeFormAction(action);
          fieldResults[action.elementId] = {
            status: 'success',
            label: getLabelOrPlaceholder(action.elementId),
            value: action.value
          };
         completedActions++;
         
         const newProgressPercent = Math.round((completedActions / totalActions) * 100);
         showSlidingStatus(`Completed ${action.elementId}: ${action.explanation}`, "success", newProgressPercent, "fill");
         
         applicationState.actionHistory.push({
           step: applicationState.currentStep++,
           action: action.action,
           elementId: action.elementId,
           value: action.value,
           explanation: action.explanation
         });
       } catch (error) {
         console.error(`Error executing action on ${action.elementId}:`, error);
         showSlidingStatus(`Error with ${action.elementId}: ${error.message}`, "error");
          fieldResults[action.elementId] = {
            status: 'error',
            label: getLabelOrPlaceholder(action.elementId),
            error: error?.message || 'Unknown error'
          };
       }
     }
     
     if (actions.submitForm === true) {
       const submitButtons = applicationState.detectedElements.buttons.filter(btn =>
         btn.type === 'submit' ||
         btn.text.toLowerCase().includes('submit') ||
         btn.text.toLowerCase().includes('apply')
       );
       
       if (submitButtons.length > 0) {
         showSlidingStatus("Preparing to submit the form...", "progress", 100, "submit");
         console.log("Submitting form...");
         setTimeout(() => {
           showSlidingStatus("Submitting form...", "progress", 100, "submit");
           
           chrome.runtime.sendMessage({
             action: 'formAction',
             progress: 100,
             action: "Submitting form",
             explanation: "Clicking submit button",
             type: "success"
           }).catch(error => {
             console.log("No active popup to update submit action");
           });
           
           submitButtons[0].domElement.click();
           
           applicationState.actionHistory.push({
             step: applicationState.currentStep++,
             action: "submit",
             explanation: "Submitted the form"
           });
           
           showSlidingStatus("Form submitted successfully!", "success", 100, "submit");
            try { showFieldResultsPanel(fieldResults, totalActions); } catch (_) {}
           
           chrome.runtime.sendMessage({
             action: 'completeAutomation',
             success: true
           }).catch(error => {
             console.log("No active popup to notify of completion");
           });
           
           const pageTitle = document.title;
           const pageUrl = window.location.href;
           
           try {
             const h1Elements = document.querySelectorAll('h1');
             let jobTitle = '';
             let company = '';
             
             if (h1Elements.length > 0) {
               jobTitle = h1Elements[0].textContent.trim();
               
               const metaTags = document.querySelectorAll('meta[property="og:site_name"], meta[name="author"]');
               if (metaTags.length > 0) {
                 company = metaTags[0].getAttribute('content');
               } else {
                 const titleParts = pageTitle.split('|');
                 if (titleParts.length > 1) {
                   company = titleParts[titleParts.length - 1].trim();
                 } else if (titleParts.length === 1) {
                   const titleParts2 = pageTitle.split('-');
                   if (titleParts2.length > 1) {
                     company = titleParts2[titleParts2.length - 1].trim();
                   }
                 }
               }
             }
             
             const application = {
               jobTitle: jobTitle || 'Job Position',
               company: company || 'Company',
               url: pageUrl,
               date: new Date().toISOString(),
               status: 'applied',
               resumeUsed: true,
               coverLetterUsed: !!actions.coverLetter
             };
             
             chrome.runtime.sendMessage({
               action: 'trackApplication',
               application: application
             });
           } catch (error) {
             console.error("Error tracking application:", error);
           }
         }, 1000);
       } else {
         console.warn("Submit button not found");
         showSlidingStatus("Submit button not found on page", "warning", 100, "fill");
       }
     } else {
       showSlidingStatus("Form filling completed (not submitting)", "success", 100, "fill");
     }

      // Post-run failure check: scan all inputs/selects in the form for empties
      try {
        const containerEl = document.body; // scope across page; could be narrowed if needed
        const inputNodes = Array.from(containerEl.querySelectorAll('input, textarea, select'));
        const additionalFailures = {};
        // Helper to create a polished, user-friendly label for any field
        const toTitle = (s) => (s || '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, c => c.toUpperCase());
        const deriveFriendlyFieldLabel = (node) => {
          // 1) Associated <label>
          const fromLabel = (node.labels && node.labels[0] && node.labels[0].textContent)
            ? node.labels[0].textContent.trim()
            : '';
          if (fromLabel) return fromLabel;

          // 2) aria-labelledby
          const ariaLabelledby = node.getAttribute('aria-labelledby');
          if (ariaLabelledby) {
            const text = ariaLabelledby.split(/\s+/).map(id => {
              const el = document.getElementById(id);
              return el ? el.textContent.trim() : '';
            }).filter(Boolean).join(' ');
            if (text) return text;
          }

          // 3) aria-label or placeholder
          const ariaLabel = node.getAttribute('aria-label');
          if (ariaLabel) return ariaLabel.trim();
          if (node.placeholder) return node.placeholder.trim();

          // 4) name or id, formatted
          if (node.name) return toTitle(node.name);
          if (node.id) return toTitle(node.id);

          // 5) Type-based fallback
          const tag = node.tagName.toLowerCase();
          const type = (node.type || '').toLowerCase();
          if (tag === 'textarea') return 'Message';
          if (tag === 'select') return 'Selection';
          if (type === 'email') return 'Email';
          if (type === 'tel') return 'Phone';
          if (type === 'url') return 'Website';
          if (type === 'password') return 'Password';
          if (type === 'checkbox') return 'Checkbox';
          if (type === 'radio') return 'Radio Option';
          return 'Form Field';
        };

        // First pass: build radio groups by name to evaluate emptiness at group level
        const radioGroups = new Map();
        for (const node of inputNodes) {
          if ((node.type || '').toLowerCase() !== 'radio') continue;
          const style = window.getComputedStyle(node);
          if (node.disabled || style.display === 'none' || style.visibility === 'hidden') continue;
          const name = node.name || `(unnamed-radio-${Math.random().toString(36).slice(2)})`;
          const entry = radioGroups.get(name) || {
            nodes: [], anyChecked: false, anyRequired: false, label: ''
          };
          entry.nodes.push(node);
          entry.anyChecked = entry.anyChecked || !!node.checked;
          entry.anyRequired = entry.anyRequired || !!node.required || node.getAttribute('aria-required') === 'true';
          if (!entry.label) {
            try { entry.label = getGroupLabelText(node) || deriveFriendlyFieldLabel(node); } catch(_) { entry.label = deriveFriendlyFieldLabel(node); }
          }
          radioGroups.set(name, entry);
        }

        // Second pass: evaluate non-radio inputs individually
        let emptyFieldIdCounter = 0;
        for (const node of inputNodes) {
          const type = (node.type || '').toLowerCase();
          if (type === 'radio') continue; // radios handled at group level
          // Ignore hidden/disabled elements
          const style = window.getComputedStyle(node);
          if (node.disabled || style.display === 'none' || style.visibility === 'hidden') continue;
          // Determine emptiness depending on type
          let isEmpty = false;
          if (node.tagName === 'SELECT') {
            isEmpty = node.selectedIndex === -1 || node.value === '' || node.value == null;
          } else if (type === 'checkbox') {
            // Consider unchecked required checkbox as empty
            isEmpty = !!node.required && !node.checked;
          } else {
            isEmpty = (String(node.value || '').trim() === '');
          }
          if (isEmpty) {
            const id = node.id || node.name || `field_${++emptyFieldIdCounter}`; // avoid leaking raw HTML
            if (!fieldResults[id]) {
              fieldResults[id] = {
                status: 'error',
                label: deriveFriendlyFieldLabel(node),
                error: 'Field appears empty'
              };
            }
          }
        }

        // Third pass: add radio group failures once per group
        for (const [name, group] of radioGroups.entries()) {
          if (group.anyRequired && !group.anyChecked) {
            const id = name;
            if (!fieldResults[id]) {
              fieldResults[id] = {
                status: 'error',
                label: group.label || toTitle(name),
                error: 'Field appears empty'
              };
            }
          }
        }
      } catch (_) { /* ignore scanning errors */ }

      try { showFieldResultsPanel(fieldResults, totalActions); } catch (_) {}
     
     return true;
   }

   async function executeFormAction(action) {
     console.log(`Executing ${action.action} on ${action.elementId}`);
     const startTime = performance.now();
     logSystem.system(`▶️ Starting action: ${action.action} on ${action.elementId}`);
     
     const { elementId, action: actionType, value } = action;
     
     logSystem.info(`Finding element with ID ${elementId}`);
     let element = findElementById(elementId);
     if (!element) {
       logSystem.error(`Element with ID ${elementId} not found`);
       console.error(`Element with ID ${elementId} not found`);
       throw new Error(`Element not found`);
     }
     
     logSystem.info(`Found element: ${element.labelText || element.placeholder || element.id}`);
     const domElement = element.domElement;
     const originalBorder = domElement.style.border;
     const originalBackground = domElement.style.backgroundColor;
     
     domElement.style.border = '2px solid #4285f4';
     domElement.style.backgroundColor = '#e8f0fe';
     logSystem.info(`Scrolling to element: ${elementId}`);
     domElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
     
     // Log timing for element preparation
     const prepTime = performance.now();
     logSystem.info(`Element preparation took ${Math.round(prepTime - startTime)}ms`);
     
     switch (actionType) {
       case 'fill':
         logSystem.info(`Filling text: "${value.substring(0, 30)}${value.length > 30 ? '...' : ''}"`);
         domElement.focus();
         domElement.value = value;
         domElement.dispatchEvent(new Event('input', { bubbles: true }));
         domElement.dispatchEvent(new Event('change', { bubbles: true }));
          // Removed success log for cleaner UI
         break;
        case 'select':
         logSystem.info(`Selecting value: "${value}"`);
         
         // First focus on the element to simulate user interaction
         domElement.focus();
         
         // Create and dispatch proper mouse events for dropdown interaction
         domElement.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
         domElement.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
         domElement.dispatchEvent(new MouseEvent('click', { bubbles: true }));
         
         return new Promise(resolve => setTimeout(() => {
            // For SELECT elements, find and select the option by value
            if (domElement.tagName === 'SELECT' && domElement.options) {
              // Find the matching option by value or visible text (case-insensitive)
              const desired = String(value ?? '').trim().toLowerCase();
              let selectedIndex = -1;
              let selectedOption = null;
              const options = Array.from(domElement.options);
              for (let i = 0; i < options.length; i++) {
                const opt = options[i];
                const optVal = String(opt.value ?? '').trim().toLowerCase();
                const optText = String(opt.textContent ?? '').trim().toLowerCase();
                if (optVal === desired || optText === desired || optText.includes(desired)) {
                  selectedIndex = i; selectedOption = opt; break;
                }
              }
             
               if (selectedOption) {
                try {
                  // Use native setter so React/Angular listeners fire
                  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
                  if (setter) setter.call(domElement, selectedOption.value);
                  else domElement.value = selectedOption.value;
                } catch (_) { domElement.value = selectedOption.value; }

                domElement.selectedIndex = selectedIndex;
               selectedOption.selected = true;
               logSystem.info(`Option "${selectedOption.text}" selected`);
                 // Also set value at the form element level if present
                 try { if (domElement.form && domElement.name) domElement.form[domElement.name].value = selectedOption.value; } catch(_) {}
             } else {
                logSystem.warning(`No exact match for "${value}". Falling back to first option.`);
                if (options.length > 0) {
                  const fallback = options[0];
                  try {
                    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
                    if (setter) setter.call(domElement, fallback.value);
                    else domElement.value = fallback.value;
                  } catch (_) { domElement.value = fallback.value; }
                  domElement.selectedIndex = 0; fallback.selected = true;
                    try { if (domElement.form && domElement.name) domElement.form[domElement.name].value = fallback.value; } catch(_) {}
                }
             }
           } else if (domElement.getAttribute('role') === 'combobox' || 
                     (domElement.parentElement && domElement.parentElement.classList.contains('dropdown'))) {
             // Handle custom dropdown components
             logSystem.info(`Handling custom dropdown component`);
             
             // Set value and try to find any visible dropdown menu that appeared
             domElement.value = value;
             
             // Look for dropdown items that might have appeared
             const dropdownItems = document.querySelectorAll('.dropdown-item, [role="option"], .select-option');
             
             // Find and click the matching item if found
             for (const item of dropdownItems) {
               if (item.textContent.includes(value) || item.getAttribute('data-value') === value) {
                 item.click();
                  // Avoid verbose log noise
                 break;
               }
             }
           } else {
             // Fallback for non-standard elements
             console.warn('Element is not a standard select element:', domElement);
             logSystem.warning(`Using fallback method for non-standard select element: ${domElement.tagName}`);
             
             // Try to set the value directly
             domElement.value = value;
           }
           
           // Dispatch all relevant events in proper sequence to ensure form state is updated
            if (domElement.tagName === 'SELECT') {
              // Native selects typically do not emit input events; only change should fire
              domElement.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
            } else {
              domElement.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
              domElement.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
            }
           domElement.dispatchEvent(new Event('blur', { bubbles: true }));
           
           // Add a small delay for any JavaScript on the page to process the selection
            // Removed timing log
           
           // Longer delay to ensure form state is updated before moving to next field
            setTimeout(() => {
              // Verify selection held; if not, retry a stronger change sequence
              try {
                if (domElement.tagName === 'SELECT' && domElement.options) {
                  const desired = String(value ?? '').trim();
                  if (domElement.value !== desired) {
                    // Try to find exact match again and re-apply
                    const opts = Array.from(domElement.options);
                    const match = opts.find(o => o.value === desired || (o.textContent || '').trim() === desired);
                    if (match) {
                      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
                      try { setter ? setter.call(domElement, match.value) : (domElement.value = match.value); } catch(_) { domElement.value = match.value; }
                      domElement.selectedIndex = opts.indexOf(match); match.selected = true;
                      try { if (domElement.form && domElement.name) domElement.form[domElement.name].value = match.value; } catch(_) {}
                    }
                    domElement.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                  }
                  // If the site uses hidden inputs to mirror selects, sync them
                  try {
                    const hiddenMirror = domElement.name ? domElement.form && domElement.form.querySelector(`input[type="hidden"][name="${domElement.name}"]`) : null;
                    if (hiddenMirror) {
                      hiddenMirror.value = domElement.value;
                      hiddenMirror.dispatchEvent(new Event('input', { bubbles: true }));
                      hiddenMirror.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                  } catch(_) {}
                } else if (domElement.getAttribute('role') === 'combobox') {
                  // For custom components, press Enter to commit value if needed
                  domElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                  domElement.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
                }
              } catch (_) {}
              resolve();
            }, 1500);
         }, 300));
       case 'check':
         logSystem.info(`Setting checkbox to: ${value === true || value === 'true' ? 'checked' : 'unchecked'}`);
         domElement.checked = value === true || value === 'true';
         domElement.dispatchEvent(new Event('change', { bubbles: true }));
          // Removed success log
         break;
       case 'radio':
         logSystem.info(`Selecting radio option`);
         domElement.checked = true;
         domElement.dispatchEvent(new Event('change', { bubbles: true }));
          // Removed success log
         break;
       case 'upload':
         if (value === "resumeFile") {
           logSystem.info(`Preparing resume upload`);
           // Check for resume availability directly before trying to upload
           return new Promise(resolve => {
             chrome.storage.local.get(['resumeData', 'resumeFile', 'resumeName', 'resumeType'], function(storageData) {
               if (!storageData.resumeData || !storageData.resumeFile) {
                 logSystem.error(`No saved resume found`);
               domElement.style.border = '2px solid #ea4335';
               showSlidingStatus("No saved resume found. Please upload manually.", "warning", null, "fill");
                 
                 // Show a more detailed dialog with settings option
               const overlay = document.createElement('div');
               overlay.style.cssText = `
                 position: fixed;
                   top: 0;
                   left: 0;
                   width: 100%;
                   height: 100%;
                   background-color: rgba(0, 0, 0, 0.7);
                 z-index: 10000;
                   display: flex;
                   align-items: center;
                   justify-content: center;
                 `;
                 
                 const dialog = document.createElement('div');
                 dialog.style.cssText = `
                   background-color: #1c1e26;
                   color: #e3e3e3;
                   border-radius: 12px;
                   padding: 24px;
                   max-width: 400px;
                 text-align: center;
                   box-shadow: 0 12px 48px rgba(0, 0, 0, 0.4);
                   font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif;
                 `;
                 
                 dialog.innerHTML = `
                   <div style="font-size: 24px; margin-bottom: 16px;">📄 Resume Required</div>
                   <p style="margin-bottom: 20px; line-height: 1.5; color: rgba(255, 255, 255, 0.8);">
                     No resume found. Please upload one in settings or click below to manually select a file.
                   </p>
                   <div style="display: flex; justify-content: center; gap: 12px; flex-wrap: wrap;">
                     <button id="manual-upload" style="padding: 12px 16px; background: rgba(255, 255, 255, 0.1); color: white; border: none; border-radius: 8px; cursor: pointer;">
                       Manual Upload
                     </button>
                     <button id="open-settings-upload" style="padding: 12px 20px; background: #f0a830; color: #1c1e26; font-weight: 500; border: none; border-radius: 8px; cursor: pointer;">
                       Open Settings
                     </button>
                   </div>
                 `;
                 
                 overlay.appendChild(dialog);
               document.body.appendChild(overlay);
                 
                 document.getElementById('manual-upload').addEventListener('click', () => {
                 document.body.removeChild(overlay);
                   domElement.click(); // Trigger the file input
                 });
                 
                 document.getElementById('open-settings-upload').addEventListener('click', () => {
                   document.body.removeChild(overlay);
                   toggleSettingsPanel();
                 });
                 
                 resolve();
                 return;
               } else {
                 logSystem.info(`Resume data found, proceeding with upload`);
                 const uploadStartTime = performance.now();
                 // We have a resume, proceed with upload
             const uploadResult = uploadResumeToPage(
               storageData.resumeFile,
               storageData.resumeName,
               storageData.resumeType
             );
             
                  // Removed upload timing log; keep result in UI via showSlidingStatus
                  logSystem.info(`Upload result: ${uploadResult}`);
             showSlidingStatus(uploadResult, uploadResult.includes("successfully") ? "success" : "warning", null, "fill");
               }
               
                // Removed final timing log for upload
               resolve();
             });
           });
         } else if (value === "coverLetterFile") {
           logSystem.info(`Preparing cover letter upload`);
           
           // Get the current cover letter or generate one
           return new Promise(resolve => {
             chrome.storage.local.get(['currentCoverLetter'], async function(result) {
               if (!result.currentCoverLetter) {
                 logSystem.warning("No cover letter available. Checking if AI generated one...");
                 
                 // Check if there's a cover letter in the AI response
                 const aiResponse = applicationState.currentAIResponse;
                 if (aiResponse && aiResponse.coverLetter && aiResponse.coverLetter.content) {
                   logSystem.success("Found cover letter in AI response, using that");
                   
                   try {
                     // Get cover letter settings first to check if we need to modify anything
                     chrome.storage.local.get(['coverLetterSettings'], async function(settingsResult) {
                       const coverLetterSettings = settingsResult.coverLetterSettings;
                       let coverLetterContent = aiResponse.coverLetter.content;
                       
                       // Apply any custom closing if provided in settings
                       if (coverLetterSettings && coverLetterSettings.customClosing && coverLetterSettings.customClosing.trim() !== '') {
                         logSystem.info("Applying custom closing statement from settings");
                         
                         // Replace the last paragraph (assumed to be the closing) with the custom closing
                         const paragraphs = coverLetterContent.split("\n\n");
                         if (paragraphs.length > 1) {
                           paragraphs[paragraphs.length - 1] = coverLetterSettings.customClosing.trim();
                           coverLetterContent = paragraphs.join("\n\n");
                         }
                       }
                       
                      // Determine a fresh filename from page context to avoid stale company names
                      const deriveCompany = () => {
                        try {
                          const og = document.querySelector('meta[property="og:site_name"]')?.content?.trim();
                          if (og) return og;
                          const host = location.hostname.replace(/^www\./, '');
                          return host.split('.')?.[0] || 'Company';
                        } catch (_) { return 'Company'; }
                      };
                      const derivePosition = () => {
                        try {
                          const h1 = document.querySelector('h1');
                          if (h1 && h1.textContent) return h1.textContent.trim().slice(0, 80);
                          return (document.title || 'Position').split('|')[0].split('-')[0].trim();
                        } catch (_) { return 'Position'; }
                      };
                      const safe = s => (s || '').replace(/[^a-z0-9_\-\s]/gi, '').replace(/\s+/g, '_');
                      const freshCompany = safe(deriveCompany());
                      const freshPosition = safe(derivePosition());
                      const resolvedFilename = `${freshCompany}_${freshPosition}_Cover_Letter.pdf`;

                      // Generate PDF from the cover letter content
                      logSystem.info("Generating PDF from cover letter content");
                       try {
                         // Use await since generatePDFFromText returns a promise
                         const dataUrl = await generatePDFFromText(
                           coverLetterContent, 
                          resolvedFilename
                         );
                         
                         // Now dataUrl is a string, not a promise
                         const uploadResult = uploadFileToElement(
                           domElement,
                           dataUrl,
                          resolvedFilename,
                           'application/pdf',
                           "cover letter"
                         );
                         
                    // Keep concise
                    logSystem.info(`Upload result: ${uploadResult}`);
                         showSlidingStatus(uploadResult, uploadResult.includes("successfully") ? "success" : "warning", null, "fill");
                       } catch (pdfError) {
                         logSystem.error(`Error generating PDF: ${pdfError.message}`);
                         showSlidingStatus(`Error generating PDF: ${pdfError.message}`, "error", null, "fill");
                       }
                     });
                   } catch (error) {
                     logSystem.error(`Error generating/uploading cover letter: ${error.message}`);
                     domElement.click(); // Fallback to manual upload
                   }
                 } else {
                   logSystem.error("No cover letter found. Please upload manually.");
               domElement.style.border = '2px solid #ea4335';
                   showSlidingStatus("No cover letter found. Please upload manually.", "warning", null, "fill");
                   
                   // Show dialog similar to resume upload dialog
               const overlay = document.createElement('div');
               overlay.style.cssText = `
                 position: fixed;
                     top: 0;
                     left: 0;
                     width: 100%;
                     height: 100%;
                     background-color: rgba(0, 0, 0, 0.7);
                 z-index: 10000;
                     display: flex;
                     align-items: center;
                     justify-content: center;
                   `;
                   
                   const dialog = document.createElement('div');
                   dialog.style.cssText = `
                     background-color: #1c1e26;
                     color: #e3e3e3;
                     border-radius: 12px;
                     padding: 24px;
                     max-width: 400px;
                 text-align: center;
                     box-shadow: 0 12px 48px rgba(0, 0, 0, 0.4);
                     font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif;
                   `;
                   
                   dialog.innerHTML = `
                     <div style="font-size: 24px; margin-bottom: 16px;">📄 Cover Letter Required</div>
                     <p style="margin-bottom: 20px; line-height: 1.5; color: rgba(255, 255, 255, 0.8);">
                       No cover letter found. Please upload one or click to select a file manually.
                     </p>
                     <div style="display: flex; justify-content: center; gap: 12px; flex-wrap: wrap;">
                       <button id="manual-upload" style="padding: 12px 16px; background: rgba(255, 255, 255, 0.1); color: white; border: none; border-radius: 8px; cursor: pointer;">
                         Manual Upload
                       </button>
                       <button id="open-settings-upload" style="padding: 12px 20px; background: #f0a830; color: #1c1e26; font-weight: 500; border: none; border-radius: 8px; cursor: pointer;">
                         Open Settings
                       </button>
                     </div>
                   `;
                   
                   overlay.appendChild(dialog);
               document.body.appendChild(overlay);
                   
                   document.getElementById('manual-upload').addEventListener('click', () => {
                 document.body.removeChild(overlay);
                     domElement.click(); // Trigger the file input
                   });
                   
                   document.getElementById('open-settings-upload').addEventListener('click', () => {
                     document.body.removeChild(overlay);
                     toggleSettingsPanel();
                   });
                 }
               } else {
                 // We have a cover letter, proceed with upload
                 logSystem.info("Found saved cover letter, proceeding with upload");
                  const coverLetter = result.currentCoverLetter;
                  // Derive a fresh filename from current page to avoid stale names from previous applications
                  const deriveCompany2 = () => {
                    try {
                      const og = document.querySelector('meta[property="og:site_name"]')?.content?.trim();
                      if (og) return og;
                      const host = location.hostname.replace(/^www\./, '');
                      return host.split('.')?.[0] || 'Company';
                    } catch (_) { return 'Company'; }
                  };
                  const derivePosition2 = () => {
                    try {
                      const h1 = document.querySelector('h1');
                      if (h1 && h1.textContent) return h1.textContent.trim().slice(0, 80);
                      return (document.title || 'Position').split('|')[0].split('-')[0].trim();
                    } catch (_) { return 'Position'; }
                  };
                  const safe2 = s => (s || '').replace(/[^a-z0-9_\-\s]/gi, '').replace(/\s+/g, '_');
                  const freshCompany2 = safe2(deriveCompany2());
                  const freshPosition2 = safe2(derivePosition2());
                  const resolvedFilename2 = `${freshCompany2}_${freshPosition2}_Cover_Letter.pdf`;
                 
                 try {
                   // Generate PDF from the cover letter content if needed
                   let dataUrl;
                    if (coverLetter.pdfDataUrl) {
                      dataUrl = coverLetter.pdfDataUrl;
                   } else {
                     logSystem.info("Generating PDF from cover letter content");
                     try {
                       // Use await since generatePDFFromText returns a promise
                       dataUrl = await generatePDFFromText(
                         coverLetter.content, 
                          resolvedFilename2
                       );
                     } catch (pdfError) {
                       logSystem.error(`Error generating PDF: ${pdfError.message}`);
                       showSlidingStatus(`Error generating PDF: ${pdfError.message}`, "error", null, "fill");
                       return;
                     }
                   }
                   
                   // Upload the cover letter
                   const uploadResult = uploadFileToElement(
                     domElement,
                     dataUrl,
                      resolvedFilename2,
                     'application/pdf',
                     "cover letter"
                   );
                   
                   logSystem.info(`Upload result: ${uploadResult}`);
                    // Update the cached name so future uses in this session reflect the new company
                    try {
                      chrome.storage.local.set({ currentCoverLetter: { ...coverLetter, filename: resolvedFilename2 } });
                    } catch (_) {}
                   showSlidingStatus(uploadResult, uploadResult.includes("successfully") ? "success" : "warning", null, "fill");
                 } catch (error) {
                   logSystem.error(`Error uploading cover letter: ${error.message}`);
                   domElement.click(); // Fallback to manual upload
                 }
               }
               
                // Removed timing log for cover letter upload
               resolve();
             });
           });
         }
         break;
       case 'click':
         logSystem.info(`Clicking element`);
         domElement.click();
          // Removed success log for click
         break;
       default:
         console.warn(`Unknown action type: ${actionType}`);
         logSystem.warning(`Unknown action type: ${actionType}`);
         showSlidingStatus(`Unknown action type: ${actionType}`, "warning", null, "fill");
     }
     
     // Calculate and log the total execution time
     const endTime = performance.now();
     const totalTime = Math.round(endTime - startTime);
      // Removed per-action completion timing log
     
     return new Promise(resolve => setTimeout(() => {
       domElement.style.border = originalBorder;
       domElement.style.backgroundColor = originalBackground;
       resolve();
     }, 500));
   }

  function findElementById(id) {
    const elements = applicationState.detectedElements;
    const collections = [
      elements.textInputs,
      elements.textareas,
      elements.selects,
      elements.checkboxes,
      elements.fileInputs,
      elements.buttons
    ];
    let record = null;
    for (const coll of collections) {
      const found = coll.find(el => el.id === id);
      if (found) { record = found; break; }
    }
    if (!record && elements.radioGroups) {
      for (const group of (elements.radioGroups || [])) {
        const radioOption = group.options.find(opt => opt.id === id);
        if (radioOption) { record = radioOption; break; }
      }
    }
    if (!record) return null;

    // Re-resolve a fresh DOM element each time to avoid stale references after re-renders
    try {
      const domId = record.domId || record.id;
      const nameAttr = record.name;
      let fresh = null;
      if (domId) {
        fresh = document.getElementById(domId) || document.querySelector(`#${CSS && CSS.escape ? CSS.escape(domId) : domId}`);
      }
      if (!fresh && nameAttr) {
        const escaped = CSS && CSS.escape ? CSS.escape(nameAttr) : nameAttr.replace(/"/g, '\\"');
        fresh = document.querySelector(`[name="${escaped}"]`);
      }
      // As a final fallback, try querying by label text proximity for selects/inputs
      if (!fresh && record.labelText) {
        const labelCandidates = Array.from(document.querySelectorAll('label')).filter(l => (l.textContent || '').trim() === record.labelText);
        for (const lbl of labelCandidates) {
          const forId = lbl.getAttribute('for');
          if (forId) {
            const el = document.getElementById(forId);
            if (el) { fresh = el; break; }
          } else {
            const el = lbl.querySelector('input, textarea, select, [role="combobox"]');
            if (el) { fresh = el; break; }
          }
        }
      }
      if (fresh) {
        record.domElement = fresh;
      }
    } catch (_) { /* ignore resolve errors */ }

    return record;
  }
   
   function getLabelOrPlaceholder(id) {
     const element = findElementById(id);
     if (!element) return id;
     if (element.labelText) return element.labelText;
     if (element.placeholder) return element.placeholder;
     if (element.options && element.options.length > 0) {
       return element.labelText || `Select field`;
     }
     if (element.name && applicationState.detectedElements.radioGroups) {
       const group = applicationState.detectedElements.radioGroups.find(g => g.name === element.name);
       if (group && group.labelText) return group.labelText;
     }
     if (element.accept) {
       if (element.accept.includes('pdf') || element.accept.includes('doc')) {
         return 'Document upload';
       }
       if (element.accept.includes('image')) {
         return 'Image upload';
       }
     }
     return element.name || id;
   }
   
   function getButtonText(id) {
     const button = applicationState.detectedElements.buttons.find(b => b.id === id);
     if (!button) return id;
     return button.text || button.value || id;
   }

   function findUploadButton(type = 'resume') {
     logSystem.info(`Finding ${type} upload field`);
     let selectors = [];
     if (type === 'resume') {
       selectors = [
         // More specific selectors first
         'input[type="file"][accept*=".pdf"][id*="resume"]',
         'input[type="file"][accept*=".doc"][id*="resume"]',
         'input[type="file"][id*="resume"]',
         'input[type="file"][id*="cv"]',
         'input[type="file"][name*="resume"]',
         'input[type="file"][name*="cv"]',
         // Find by nearby labels - case insensitive
         'input[type="file"][aria-label*="resume" i]',
         'input[type="file"][aria-label*="cv" i]',
         // File inputs inside elements with resume-related classes or IDs
         'div[id*="resume" i] input[type="file"]',
         'div[class*="resume" i] input[type="file"]',
         'label[for*="resume" i] ~ input[type="file"]',
         'label[for*="cv" i] ~ input[type="file"]',
       ];
     } else if (type === 'coverLetter') {
       selectors = [
         // More specific selectors first
         'input[type="file"][accept*=".pdf"][id*="cover"]',
         'input[type="file"][accept*=".doc"][id*="cover"]',
         'input[type="file"][id*="cover"]',
         'input[type="file"][id*="letter"]',
         'input[type="file"][name*="cover"]',
         'input[type="file"][name*="letter"]',
         // Find by nearby labels - case insensitive
         'input[type="file"][aria-label*="cover" i]',
         'input[type="file"][aria-label*="letter" i]',
         // File inputs inside elements with cover letter-related classes or IDs
         'div[id*="cover" i] input[type="file"]',
         'div[class*="cover" i] input[type="file"]',
         'label[for*="cover" i] ~ input[type="file"]',
         'label[for*="letter" i] ~ input[type="file"]',
       ];
     }
     
     // Generic file input selectors as fallbacks
     selectors.push('input[type="file"][accept*=".pdf"]');
     selectors.push('input[type="file"][accept*=".doc"]');
     selectors.push('input[type="file"]');
     
     // Try all selectors
     for (const selector of selectors) {
       logSystem.info(`Trying selector: ${selector}`);
       const elements = document.querySelectorAll(selector);
       if (elements.length > 0) {
         if (elements.length > 1) {
           logSystem.info(`Found ${elements.length} potential elements, checking labels`);
           // When multiple elements found, use label text to disambiguate
           for (const el of elements) {
             const labelText = getLabelText(el).toLowerCase();
             if (type === 'resume' && (labelText.includes('resume') || labelText.includes('cv'))) {
               logSystem.success(`Selected element with label: ${labelText}`);
               return el;
             } else if (type === 'coverLetter' && (labelText.includes('cover') || labelText.includes('letter'))) {
               logSystem.success(`Selected element with label: ${labelText}`);
               return el;
             }
           }
         }
         
         // If we can't disambiguate or there's only one element, use the first one
         logSystem.success(`Found file input with selector: ${selector}`);
         return elements[0];
       }
     }
     
     // Last resort: If no file inputs are found directly, check for elements that might be wrappers
     // for file inputs (like custom styled file inputs)
     if (type === 'resume') {
       const resumeLabels = document.querySelectorAll('label[for*="resume" i], label[for*="cv" i], div[id*="resume" i], div[id*="cv" i]');
       for (const label of resumeLabels) {
         const fileInput = label.querySelector('input[type="file"]');
         if (fileInput) {
           logSystem.success(`Found file input inside wrapper element`);
           return fileInput;
         }
       }
     } else if (type === 'coverLetter') {
       const coverLabels = document.querySelectorAll('label[for*="cover" i], label[for*="letter" i], div[id*="cover" i], div[id*="letter" i]');
       for (const label of coverLabels) {
         const fileInput = label.querySelector('input[type="file"]');
         if (fileInput) {
           logSystem.success(`Found file input inside wrapper element`);
           return fileInput;
         }
       }
     }
     
     // If all else fails, look for hidden file inputs
     const hiddenFileInputs = document.querySelectorAll('input[type="file"][style*="display: none"], input[type="file"][style*="visibility: hidden"]');
     if (hiddenFileInputs.length > 0) {
       logSystem.warning(`Only found hidden file inputs. Using first one.`);
       return hiddenFileInputs[0];
     }
     
     logSystem.error(`No ${type} upload field found`);
     return null;
   }

   function uploadFileToElement(element, fileData, fileName, fileType, fileDescription = "file") {
     if (!element) {
       return `No ${fileDescription} upload element found on this page.`;
     }
     
     try {
       let processedData = fileData;
       if (typeof fileData !== 'string') {
         console.error(`Invalid ${fileDescription} data format: not a string`, typeof fileData);
         throw new Error(`Invalid ${fileDescription} data format: not a string`);
       }
       
       if (fileData.indexOf('base64') === -1) {
         processedData = `data:${fileType || 'application/pdf'};base64,${fileData}`;
       }
       
       const parts = processedData.split('base64,');
       if (parts.length !== 2) {
         console.error(`Invalid ${fileDescription} data format: no base64 data found`);
         throw new Error(`Invalid ${fileDescription} data format: no base64 data found`);
       }
       
       const byteString = atob(parts[1]);
       const byteArrays = [];
       
       // Split into smaller chunks to avoid memory issues
       const sliceSize = 512;
       for (let offset = 0; offset < byteString.length; offset += sliceSize) {
         const slice = byteString.slice(offset, offset + sliceSize);
         const byteNumbers = new Array(slice.length);
         for (let i = 0; i < slice.length; i++) {
           byteNumbers[i] = slice.charCodeAt(i);
         }
         byteArrays.push(new Uint8Array(byteNumbers));
       }
       
       const mimeType = fileType || 'application/pdf';
       const blob = new Blob(byteArrays, { type: mimeType });
       const file = new File([blob], fileName, { type: mimeType });
       
       // Try multiple methods to set the file to accommodate different browser implementations
       let fileAssignmentSuccess = false;
       
       try {
         // Method 1: Standard DataTransfer (works in most modern browsers)
         const dataTransfer = new DataTransfer();
         dataTransfer.items.add(file);
         element.files = dataTransfer.files;
         fileAssignmentSuccess = true;
       } catch (dtError) {
         console.log("DataTransfer failed, trying alternative method:", dtError);
         
         try {
           // Method 2: Direct property assignment (works in some Safari/WebKit browsers)
           const fileList = {
             0: file,
             length: 1,
             item: function(idx) { return idx === 0 ? file : null; }
           };
           
           Object.defineProperty(element, 'files', {
             value: fileList,
             writable: true
           });
           fileAssignmentSuccess = true;
         } catch (propError) {
           console.log("Property definition failed:", propError);
           fileAssignmentSuccess = false;
         }
       }
       
       // If automatic methods fail, prompt the user
       if (!fileAssignmentSuccess) {
         // Show a more user-friendly prompt
         const overlay = document.createElement('div');
         overlay.style.cssText = `
           position: fixed;
           top: 0;
           left: 0;
           width: 100%;
           height: 100%;
           background-color: rgba(0, 0, 0, 0.7);
           z-index: 10000;
           display: flex;
           align-items: center;
           justify-content: center;
         `;
         
         const dialog = document.createElement('div');
         dialog.style.cssText = `
           background-color: #1c1e26;
           color: #e3e3e3;
           border-radius: 12px;
           padding: 24px;
           max-width: 400px;
           text-align: center;
           box-shadow: 0 12px 48px rgba(0, 0, 0, 0.4);
         `;
         
         dialog.innerHTML = `
           <div style="font-size: 24px; margin-bottom: 16px;">📄 Manual Upload Required</div>
           <p style="margin-bottom: 20px; line-height: 1.5;">
             Due to security restrictions on this website, automatic file upload isn't possible. 
             Please click the button below and then select your ${fileDescription} file manually.
           </p>
           <button id="manual-upload-btn" style="padding: 12px 20px; background: #f0a830; color: #1c1e26; border: none; border-radius: 8px; cursor: pointer; font-weight: 500;">
             Select ${fileDescription} file
           </button>
         `;
         
         overlay.appendChild(dialog);
         document.body.appendChild(overlay);
         
         document.getElementById('manual-upload-btn').addEventListener('click', () => {
           document.body.removeChild(overlay);
           element.click();
         });
         
         return `Please select your ${fileDescription} file manually.`;
       }
       
       // Trigger events
       element.dispatchEvent(new Event('change', { bubbles: true }));
       element.dispatchEvent(new Event('input', { bubbles: true }));
       
       return `${fileDescription.charAt(0).toUpperCase() + fileDescription.slice(1)} "${fileName}" uploaded successfully!`;
     } catch (error) {
       console.error(`${fileDescription} upload error:`, error);
       return `Error uploading ${fileDescription}: ${error.message}`;
     }
   }
   
   function uploadResumeToPage(resumeData, resumeName, resumeType) {
     const uploadElement = document.getElementById('resume') || findUploadButton('resume');
     if (!uploadElement) {
       return 'No upload button found on this page.';
     }
     
     try {
       // Process the resume data to get base64 content
       let base64Data;
       if (!resumeData) {
         throw new Error("No resume data provided");
       }
       
       if (typeof resumeData === 'string') {
         // Handle string data (either full data URL or just base64)
         base64Data = resumeData.indexOf('base64,') !== -1 ?
                      resumeData.split('base64,')[1] : resumeData;
       } else if (typeof resumeData === 'object') {
         // Handle object format (could be {data: base64} or {content: base64})
         if (resumeData.data) {
           base64Data = resumeData.data;
         } else if (resumeData.content) {
           base64Data = resumeData.content;
         } else {
           throw new Error("Unsupported resume object format");
         }
       } else {
         throw new Error("Invalid resume data type: " + typeof resumeData);
       }
       
       // Create a Blob from the base64 data
       const byteCharacters = atob(base64Data);
       const byteArrays = [];
       
       // Split into smaller chunks to avoid memory issues
       const sliceSize = 512;
       for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
         const slice = byteCharacters.slice(offset, offset + sliceSize);
         const byteNumbers = new Array(slice.length);
         for (let i = 0; i < slice.length; i++) {
           byteNumbers[i] = slice.charCodeAt(i);
         }
         byteArrays.push(new Uint8Array(byteNumbers));
       }
       
       const mimeType = resumeType || 'application/pdf';
       const blob = new Blob(byteArrays, { type: mimeType });
       const file = new File([blob], resumeName || "resume.pdf", { type: mimeType });
       
       // Try multiple methods to set the file
       try {
         // Method 1: DataTransfer (modern browsers)
         const dataTransfer = new DataTransfer();
         dataTransfer.items.add(file);
         uploadElement.files = dataTransfer.files;
       } catch (dtError) {
         console.log("DataTransfer failed, trying alternative method:", dtError);
         
         try {
           // Method 2: Direct property assignment with Object.defineProperty
           // This is a fallback for some Safari/WebKit browsers
           const fileList = {
             0: file,
             length: 1,
             item: function(idx) { return idx === 0 ? file : null; }
           };
           
           Object.defineProperty(uploadElement, 'files', {
             value: fileList,
             writable: true
           });
         } catch (propError) {
           console.log("Property definition failed:", propError);
           // Method 3: Last resort - trigger click and let user select manually
           alert("Automatic resume upload not supported in this browser. Please click OK and then select your resume file manually.");
           uploadElement.click();
         }
       }
       
       // Trigger change events - important for form validation
       uploadElement.dispatchEvent(new Event('change', { bubbles: true }));
       uploadElement.dispatchEvent(new Event('input', { bubbles: true }));
       
       return `Resume "${resumeName || "resume.pdf"}" uploaded successfully!`;
     } catch (error) {
       console.error("Resume upload error:", error);
       return `Error uploading resume: ${error.message}`;
     }
   }
   
   async function startAutomation(settings = {}) {
     try {
       // Check if automation is already running
     if (applicationState.isProcessing) {
         logSystem.warning("Automation is already in progress. Please wait.");
       showSlidingStatus("Automation already in progress", "warning", null, "init");
         return { 
           success: false, 
           message: "Automation already in progress. Please wait." 
         };
     }
       
       logSystem.system("Starting application automation process");
       
       // Reset application state
     applicationState.isProcessing = true;
       applicationState.currentStep = 0;
       applicationState.currentAction = null;
       applicationState.tokenUsage = 0;
       
       // Preload required libraries
       logSystem.info("Loading required libraries...");
       await loadRequiredLibraries().catch(err => {
         logSystem.warning(`Some libraries may not have loaded properly: ${err.message}`);
       });
       
       // Get advanced settings
       let advancedSettings = null;
       try {
         advancedSettings = await new Promise(resolve => {
           chrome.storage.local.get(['advancedSettings'], result => {
             if (result.advancedSettings) {
               resolve(result.advancedSettings);
             } else {
               // Default settings if not found
               resolve({
                 fillOptionalFields: true,
                 enhancedJobMatching: true,
                 autosaveApplications: false,
                 aiPersonality: "Professional (Default)"
               });
             }
           });
         });
         logSystem.info(`Advanced settings loaded: ${JSON.stringify(advancedSettings)}`);
       } catch (error) {
         logSystem.warning(`Could not load advanced settings: ${error.message}`);
       }
       
       // Create sliding window for status if needed
       if (!document.querySelector('.snapphil-status-window')) {
         createSlidingStatusWindow();
       }
       
       // Show the window and reset status
       showSlidingWindow();
       addStatus('init', 'rocket', 'Initializing');
       addStatus('detect', 'search', 'Detecting Form');
       addStatus('analyze', 'brain', 'AI Analysis');
       addStatus('fill', 'pen', 'Filling Form');
       addStatus('submit', 'paper-plane', 'Submission');
       
       // Try to activate the window
       window.focus();
       
       // First status update
       showSlidingStatus("Getting ready", "progress", 0, "init");
       
       logSystem.info("Starting form element detection");
       
       // Check if resume is available
       const hasResume = await checkResumeAvailability();
       if (!hasResume) {
         logSystem.error("Resume not found! Prompting user to upload");
         showSlidingStatus("No resume found", "error", null, "init");
         
         const resumeUploadResult = await promptUploadResume();
         if (!resumeUploadResult) {
         applicationState.isProcessing = false;
           logSystem.error("Resume upload was canceled by user");
           showSlidingStatus("Process canceled", "error", null, "init");
           return { 
             success: false, 
             message: "Resume upload was canceled by user" 
           };
         }
         
         logSystem.success("Resume uploaded successfully, continuing automation");
         showSlidingStatus("Resume uploaded successfully", "success", 25, "init");
       }
       
       // Detect form elements
       showSlidingStatus("Analyzing page content...", "progress", 15, "detect");
       const formElements = detectFormElements();
       logSystem.info(`Detected ${Object.keys(formElements || {}).length} form elements`);
       
       // Store elements for later
       applicationState.detectedElements = formElements;
       
       // Get page text for context
       const pageText = getPageText();
       
       // We've detected the form, update status
       showSlidingStatus("Form detected", "success", 30, "detect");
       
       // If using detect-only mode, show results and stop
       if (settings.detectOnly) {
         logSystem.info("Detection-only mode active, stopping before AI analysis");
         showSlidingStatus("Form elements detected", "success", 100, "detect");
         applicationState.isProcessing = false;
         
         // Create a display of the elements for debugging
         const debugDisplay = document.createElement('div');
         debugDisplay.className = 'snapphil-debug-display';
         debugDisplay.innerHTML = `
           <h3>Detected Form Elements</h3>
           <pre>${JSON.stringify(formElements, null, 2)}</pre>
           <button class="snapphil-close-debug">Close</button>
         `;
         document.body.appendChild(debugDisplay);
         
         debugDisplay.querySelector('.snapphil-close-debug').addEventListener('click', function() {
           document.body.removeChild(debugDisplay);
         });
         
         return {
           success: true,
           message: "Form elements detected successfully",
           formElements: formElements
         };
       }
       
       // Start AI Analysis
       showSlidingStatus("AI analyzing form...", "progress", 40, "analyze");
       logSystem.info("Starting AI analysis of form");
       
       const startTime = performance.now();
       
       try {
         const aiResponse = await chrome.runtime.sendMessage({
           action: "analyzeFormWithAI",
           formElements: formElements,
           pageText: pageText,
           actionHistory: applicationState.actionHistory || []
         }).catch(error => {
           // Handle communication errors
           logSystem.error(`Communication error with background script: ${error.message}`);
           
           // Check if the error is related to getCoverLetterSettings
           if (error.message && error.message.includes('getCoverLetterSettings is not defined')) {
             logSystem.warning("Cover letter settings issue detected, retrying with a fallback...");
             
             // Try again with explicit instruction to use fallback
             return chrome.runtime.sendMessage({
               action: "analyzeFormWithAI",
               formElements: formElements,
               pageText: pageText,
               actionHistory: applicationState.actionHistory || [],
               useFallbackSettings: true
              }).catch(() => null);
           }
           
           throw new Error(`Failed to communicate with AI service: ${error.message}`);
         });
         
         if (!aiResponse) {
           // Handle null response
           logSystem.error("No response received from AI service");
           throw new Error("No response received from AI service");
         }
         
         const responseTime = Math.round(performance.now() - startTime);
         logSystem.info(`AI response received in ${responseTime}ms`);
         
         if (aiResponse.error) {
           logSystem.error(`AI analysis error: ${aiResponse.message}`);
           showSlidingStatus(`Error: ${aiResponse.message}`, "error", null, "analyze");
           applicationState.isProcessing = false;
           return { 
             success: false, 
             message: aiResponse.message 
           };
         }
         
         logSystem.success("AI response received successfully");
         console.log("AI response:", aiResponse);
         showSlidingStatus("AI analysis completed successfully", "success", 40, "analyze");
         
         // Store the AI response in the application state for later use
         applicationState.currentAIResponse = aiResponse;
         
         if (aiResponse.tokenUsage) {
           logSystem.info(`Token usage: ${aiResponse.tokenUsage} tokens`);
           applicationState.tokenUsage = aiResponse.tokenUsage;
         }
         
         if (aiResponse.coverLetter && aiResponse.coverLetter.content) {
           logSystem.success(`Cover letter generated: "${aiResponse.coverLetter.filename}"`);
           showSlidingStatus(`Cover letter generated: "${aiResponse.coverLetter.filename}"`, "success", 45, "analyze");
         }
         
         if (!aiResponse.formActions || aiResponse.formActions.length === 0) {
           logSystem.warning("AI did not return any form actions");
           showSlidingStatus("No actions to perform on this form", "warning", null, "analyze");
         applicationState.isProcessing = false;
           return { 
             success: false, 
             message: "AI did not return any actions to perform" 
           };
         }
         
         // Execute form actions
         showSlidingStatus("Filling form...", "progress", 50, "fill");
         logSystem.info(`Starting to execute ${aiResponse.formActions.length} form actions`);
         
         // Sort actions - prioritize uploads first, then regular field filling
         const sortedActions = [...aiResponse.formActions].sort((a, b) => {
           // Prioritize uploads
           if (a.action === 'upload' && b.action !== 'upload') return -1;
           if (a.action !== 'upload' && b.action === 'upload') return 1;
           return 0;
         });
         
         // Apply advanced settings to modify behavior
         if (advancedSettings) {
           // If fillOptionalFields is false, skip fields marked as optional
           if (advancedSettings.fillOptionalFields === false) {
             logSystem.info("Skip optional fields setting enabled, filtering actions");
             const requiredActions = sortedActions.filter(action => {
               const element = findElementById(action.elementId);
               // If we can't find the element, assume it's required to be safe
               if (!element) return true;
               
               // Check if element has 'required' attribute or asterisk in label
               const isRequired = element.domElement.required || 
                                 (element.labelText && element.labelText.includes('*'));
               
               // Keep required elements and file uploads (which are usually important)
               return isRequired || action.action === 'upload';
             });
             
             logSystem.info(`Filtered actions from ${sortedActions.length} to ${requiredActions.length} required fields`);
             
             // Only update if we still have some actions left
             if (requiredActions.length > 0) {
               sortedActions.length = 0; // Clear array
               sortedActions.push(...requiredActions); // Add filtered actions
             }
           }
           
           // Apply personality to text fields if enhancedJobMatching is enabled
           if (advancedSettings.enhancedJobMatching === true && 
               advancedSettings.aiPersonality && 
               advancedSettings.aiPersonality !== "Professional (Default)") {
             
             logSystem.info(`Applying ${advancedSettings.aiPersonality} personality to responses`);
             
             // Modify text field responses based on personality
             sortedActions.forEach(action => {
               if (action.action === 'fill' && typeof action.value === 'string' && action.value.length > 30) {
                 let modifiedValue = action.value;
                 
                 switch (advancedSettings.aiPersonality) {
                   case "Enthusiastic":
                     modifiedValue = makeTextEnthusiastic(modifiedValue);
                     break;
                   case "Technical":
                     modifiedValue = makeTextTechnical(modifiedValue);
                     break;
                   case "Creative":
                     modifiedValue = makeTextCreative(modifiedValue);
                     break;
                 }
                 
                 if (modifiedValue !== action.value) {
                   action.value = modifiedValue;
                   action.explanation = `${action.explanation} (${advancedSettings.aiPersonality} style)`;
                 }
               }
             });
           }
         }
         
         // Execute the actions
         await executeFormActions(sortedActions);
         
         // Submit the form if requested and auto-submit is enabled
         if (aiResponse.submitForm && !settings.preventSubmit) {
           logSystem.info("Form filling complete, preparing to submit");
           showSlidingStatus("Form filled successfully", "success", 90, "fill");
           
           // Auto-track application for statistics
           if (advancedSettings && advancedSettings.autosaveApplications) {
             logSystem.info("Auto-tracking application (autosave enabled)");
             
             // Try to extract job details from AI response and page
             const jobTitle = aiResponse.jobTitle || 
                            aiResponse.extractedData?.jobTitle || 
                            document.title || "Unknown Position";
             
             const company = aiResponse.company || 
                           aiResponse.extractedData?.company || 
                           document.location.hostname || "Unknown Company";
             
             const applicationUrl = window.location.href;
             
             // Get stored cover letter if generated for this application
             chrome.storage.local.get(['lastGeneratedCoverLetter', 'resumeData'], (storageResult) => {
               const coverLetterId = storageResult.lastGeneratedCoverLetter?.coverLetterId || null;
               const resumeId = storageResult.resumeData?.resumeId || null;
               
               chrome.runtime.sendMessage({
                 action: "trackApplication",
                 application: {
                   jobTitle: jobTitle,
                   company: company,
                   url: applicationUrl,
                   status: "applied",
                   appliedDate: new Date().toISOString(),
                   tokenUsage: aiResponse.tokenUsage || 0,
                   resumeId: resumeId,
                   coverLetterId: coverLetterId
                 }
               }, (response) => {
                 if (response && response.success) {
                   logSystem.success("Application tracked successfully");
                   showSlidingStatus("Application tracked", "success", 100, "track");
                 } else {
                   logSystem.error("Failed to track application:", response?.error);
                 }
               });
             });
           }
           
           // Add small delay before submitting
           setTimeout(() => {
             showSlidingStatus("Submitting application...", "progress", 95, "submit");
             
             // Look for submit button more carefully
             const submitButton = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"]'))
               .find(btn => {
                 const text = btn.textContent || btn.value || "";
                 return /submit|apply|send|continue/i.test(text) && 
                        !btn.disabled && 
                        btn.offsetParent !== null;
               });
             
             if (submitButton) {
               logSystem.info("Found submit button:", submitButton.textContent || submitButton.value);
               submitButton.click();
               showSlidingStatus("Application submitted!", "success", 100, "submit");
             } else {
               logSystem.warning("Could not find submit button - form filled but not submitted");
               showSlidingStatus("Form filled - please submit manually", "warning", 100, "fill");
             }
           }, 1000);
         } else {
           // Auto-track application even if not submitting
           if (advancedSettings && advancedSettings.autosaveApplications) {
             logSystem.info("Auto-tracking application (no submit)");
             
             const jobTitle = aiResponse.jobTitle || 
                            aiResponse.extractedData?.jobTitle || 
                            document.title || "Unknown Position";
             
             const company = aiResponse.company || 
                           aiResponse.extractedData?.company || 
                           document.location.hostname || "Unknown Company";
             
             const applicationUrl = window.location.href;
             
             // Get stored cover letter if generated for this application
             chrome.storage.local.get(['lastGeneratedCoverLetter', 'resumeData'], (storageResult) => {
               const coverLetterId = storageResult.lastGeneratedCoverLetter?.coverLetterId || null;
               const resumeId = storageResult.resumeData?.resumeId || null;
               
               chrome.runtime.sendMessage({
                 action: "trackApplication",
                 application: {
                   jobTitle: jobTitle,
                   company: company,
                   url: applicationUrl,
                   status: "draft", // Mark as draft since not submitted
                   appliedDate: new Date().toISOString(),
                   tokenUsage: aiResponse.tokenUsage || 0,
                   resumeId: resumeId,
                   coverLetterId: coverLetterId
                 }
               }, (response) => {
                 if (response && response.success) {
                   logSystem.success("Application saved as draft");
                   showSlidingStatus("Application saved", "success", 100, "track");
                 } else {
                   logSystem.error("Failed to save application:", response?.error);
                 }
               });
             });
           }
           
           showSlidingStatus("Form filled successfully", "success", 100, "fill");
           logSystem.success("Form automation completed successfully");
         }
       } catch (error) {
         logSystem.error(`Automation error: ${error.message}`);
         showSlidingStatus(`Error: ${error.message}`, "error", null, "analyze");
         applicationState.isProcessing = false;
         return { 
           success: false, 
           message: `Automation error: ${error.message}` 
         };
       }
     } catch (error) {
       console.error("Automation error:", error);
       applicationState.isProcessing = false;
       logSystem.error(`Critical error: ${error.message}`);
       return { 
         success: false, 
         message: `Critical error: ${error.message}` 
       };
     }
   }

   // Check if resume is available in local storage or try to get from server
   function checkResumeAvailability() {
     return new Promise((resolve) => {
       chrome.runtime.sendMessage({
         action: "checkResumeAvailability"
       }, (response) => {
         if (chrome.runtime.lastError) {
           console.error("Error checking resume availability:", chrome.runtime.lastError);
           resolve(false);
           return;
         }
         resolve(response.available === true);
       });
     });
   }
   
   // Prompt the user to upload a resume when none is found
   function promptUploadResume() {
     const overlay = document.createElement('div');
     overlay.style.cssText = `
       position: fixed;
       top: 0;
       left: 0;
       width: 100%;
       height: 100%;
       background-color: rgba(0, 0, 0, 0.7);
       z-index: 10000;
       display: flex;
       align-items: center;
       justify-content: center;
     `;
     
     const dialog = document.createElement('div');
     dialog.style.cssText = `
       background-color: #1c1e26;
       color: #e3e3e3;
       border-radius: 12px;
       padding: 24px;
       max-width: 400px;
       text-align: center;
       box-shadow: 0 12px 48px rgba(0, 0, 0, 0.4);
       font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif;
     `;
     
     dialog.innerHTML = `
       <div style="font-size: 24px; margin-bottom: 16px;">📄 Resume Required</div>
       <p style="margin-bottom: 20px; line-height: 1.5; color: rgba(255, 255, 255, 0.8);">
         To auto-fill job applications, please upload your resume in the settings panel.
       </p>
       <div style="display: flex; justify-content: center; gap: 12px;">
         <button id="cancel-upload" style="padding: 12px 16px; background: rgba(255, 255, 255, 0.1); color: white; border: none; border-radius: 8px; cursor: pointer;">Cancel</button>
         <button id="open-settings" style="padding: 12px 20px; background: #f0a830; color: #1c1e26; font-weight: 500; border: none; border-radius: 8px; cursor: pointer;">Open Settings</button>
       </div>
     `;
     
     overlay.appendChild(dialog);
     document.body.appendChild(overlay);
     
     document.getElementById('cancel-upload').addEventListener('click', () => {
       document.body.removeChild(overlay);
     });
     
     document.getElementById('open-settings').addEventListener('click', () => {
       document.body.removeChild(overlay);
       toggleSettingsPanel();
     });
     
     return new Promise((resolve) => {
       overlay.addEventListener('click', (e) => {
         if (e.target === overlay) {
           resolve(false);
           document.body.removeChild(overlay);
         }
       });
       
       overlay.addEventListener('keydown', (e) => {
         if (e.key === 'Enter') {
           resolve(true);
           document.body.removeChild(overlay);
         }
       });
     });
   }

  // ===============================================================
  // Settings Panel (SET Dark Matter) Overlay Implementation
  // ===============================================================

  function toggleSettingsPanel() {
    const existing = document.getElementById('snapphil-settings-overlay');
    if (existing) {
      existing.remove();
      console.debug('SnapPhil: Settings panel removed');
      return;
    }

    // Create overlay container
    const overlay = document.createElement('div');
    overlay.id = 'snapphil-settings-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0,0,0,0.25);
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      backdrop-filter: blur(8px);
    `;

    // Add noise grain texture to the overlay
    const noiseTexture = document.createElement('div');
    noiseTexture.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      opacity: 0.08;
      pointer-events: none;
      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
    `;
    overlay.appendChild(noiseTexture);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        // Click outside iframe closes panel
        overlay.remove();
      }
    });

    // Create iframe with original dimensions to preserve the design
    const iframe = document.createElement('iframe');
    iframe.src = chrome.runtime.getURL('settings/index.html');
    iframe.style.cssText = `
      width: 800px;
      height: 500px;
      max-width: 90vw;
      max-height: 90vh;
      border: none;
      border-radius: 12px;
      box-shadow: 0 12px 48px rgba(0,0,0,0.4);
      background: #1e1e1e;
      overflow: hidden;
    `;

    // Set up message communication with iframe for auth events
    window.addEventListener('message', function(event) {
      // Verify message origin for security
      if (event.origin !== chrome.runtime.getURL('').slice(0, -1)) {
        return;
      }
      
      // Handle authentication related messages
      if (event.data.type === 'auth') {
        if (event.data.action === 'login_success' || event.data.action === 'register_success') {
          console.log('SnapPhil: Authentication successful', event.data.session);
          
          // Forward auth success to background script
          chrome.runtime.sendMessage({
            action: 'authStateChanged',
            isLoggedIn: true,
            session: event.data.session
          });
          
          // Optional: Show success notification in the page
          showToastNotification('Successfully signed in!', 'success');
        } else if (event.data.action === 'logout') {
          console.log('SnapPhil: User logged out');
          
          // Forward logout to background script
          chrome.runtime.sendMessage({
            action: 'authStateChanged',
            isLoggedIn: false
          });
        }
      }
    });

    overlay.appendChild(iframe);
    document.body.appendChild(overlay);
    console.debug('SnapPhil: Settings panel displayed');
  }
  
  // Create a toast notification function for auth feedback
  function showToastNotification(message, type = 'info') {
    const existing = document.getElementById('snapphil-toast');
    if (existing) {
      existing.remove();
    }
    
    const toast = document.createElement('div');
    toast.id = 'snapphil-toast';
    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      padding: 12px 20px;
      background: ${type === 'success' ? '#32d74b' : type === 'error' ? '#ff453a' : '#0a84ff'};
      color: white;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
      font-size: 14px;
      z-index: 2147483647;
      opacity: 0;
      transform: translateY(10px);
      transition: all 0.3s ease;
    `;
    
    toast.textContent = message;
    document.body.appendChild(toast);
    
    // Trigger animation
    setTimeout(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    }, 10);
    
    // Auto-hide after 3 seconds
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      
      // Remove from DOM after animation
      setTimeout(() => {
        toast.remove();
      }, 300);
    }, 3000);
  }

   console.log("AI-Powered Job Application Automator content script ready");

   // Helper functions for text style modifications
   function makeTextEnthusiastic(text) {
     const sentences = text.split(/(?<=[.!?])\s+/);
     
     return sentences.map(sentence => {
       // Add enthusiasm markers randomly
       if (Math.random() > 0.7) {
         return sentence.replace(/[.!?]$/, "!"); // Convert periods to exclamations
       } else if (Math.random() > 0.8) {
         return sentence.replace(/\.$/, "!!"); // Add double exclamation sometimes
       }
       return sentence;
     }).join(' ')
     // Add enthusiastic phrases
     .replace(/(I am|I'm) (interested|excited|happy|pleased)/gi, "I'm thrilled")
     .replace(/looking forward/gi, "eagerly anticipating")
     .replace(/good|great/gi, "exceptional")
     .replace(/skills/gi, "expertise")
     .replace(/experience/gi, "extensive experience")
     .replace(/worked/gi, "successfully delivered");
   }

   function makeTextTechnical(text) {
     return text
       // Technical terminology replacements
       .replace(/used/gi, "implemented")
       .replace(/made/gi, "developed")
       .replace(/built/gi, "architected")
       .replace(/created/gi, "engineered")
       .replace(/helped/gi, "facilitated")
       .replace(/I think/gi, "Analysis indicates")
       .replace(/good|great/gi, "optimal")
       .replace(/team/gi, "cross-functional team")
       .replace(/project/gi, "initiative")
       .replace(/improved/gi, "optimized")
       .replace(/increase/gi, "significant increase in efficiency")
       // Add precision
       .replace(/(\d+)%/g, (match, number) => `precisely ${number}%`);
   }

   function makeTextCreative(text) {
     return text
       // More vivid language
       .replace(/worked/gi, "crafted")
       .replace(/made/gi, "brought to life")
       .replace(/created/gi, "envisioned and executed")
       .replace(/developed/gi, "cultivated")
       .replace(/helped/gi, "collaborated to elevate")
       .replace(/increased/gi, "revolutionized")
       .replace(/improved/gi, "transformed")
       // More creative phrases
       .replace(/experience/gi, "journey")
       .replace(/skills/gi, "unique capabilities")
       .replace(/good|great/gi, "exceptional")
       .replace(/project/gi, "creative endeavor");
   }

   // Create a compact mini status window for persistent visibility
   function createMiniStatusWindow() {
     // Remove any existing mini status window
     const existingMini = document.getElementById('snapphil-mini-status');
     if (existingMini) existingMini.remove();
     
     const miniStatus = document.createElement('div');
     miniStatus.id = 'snapphil-mini-status';
     miniStatus.className = 'snapphil-mini-status';
     
     miniStatus.innerHTML = `
       <div class="mini-status-icon"><i class="fas fa-bolt"></i></div>
       <div class="mini-status-text">Ready</div>
     `;
     
     // Add mini status styles
     const miniStyles = document.createElement('style');
     miniStyles.textContent = `
       .snapphil-mini-status {
         position: fixed;
         bottom: 20px;
         left: 50%;
         transform: translateX(-50%);
         background-color: rgba(28, 30, 38, 0.9);
         color: white;
         padding: 8px 16px;
         border-radius: 20px;
         font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif;
         font-size: 12px;
         z-index: 2147483639;
         display: flex;
         align-items: center;
         gap: 8px;
         box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
         opacity: 0.9;
         cursor: pointer;
         transition: all 0.2s ease;
       }
       .snapphil-mini-status:hover {
         opacity: 1;
         transform: translateX(-50%) scale(1.05);
       }
       .mini-status-icon {
         display: flex;
         align-items: center;
         justify-content: center;
         color: #f0a830;
       }
       .mini-status-text {
         font-weight: 500;
       }
     `;
     
     document.head.appendChild(miniStyles);
     document.body.appendChild(miniStatus);
     
     // Click on mini status reopens the main sliding window
     miniStatus.addEventListener('click', () => {
       if (document.getElementById('ai-job-assistant-slider') && 
           document.getElementById('ai-job-assistant-slider').classList.contains('hidden')) {
         showSlidingWindow();
       }
     });
     
     return miniStatus;
   }

   // Terminal-style log overlay
   function createTerminalLogOverlay() {
     // Remove any existing overlay
     const existing = document.getElementById('snapphil-terminal-log');
     if (existing) existing.remove();

     // Create overlay container
     const overlay = document.createElement('div');
     overlay.id = 'snapphil-terminal-log';
     overlay.className = 'snapphil-terminal-log hidden';

     // Terminal header with toggle button
     overlay.innerHTML = `
       <div class="terminal-header">
         <span class="terminal-title">SnapPhil Terminal Log</span>
         <div class="terminal-header-btns">
           <button class="terminal-toggle-btn" title="Switch to status window">⇄</button>
           <button class="terminal-close-btn" title="Close log">×</button>
         </div>
       </div>
       <div class="terminal-content"></div>
     `;

     // Styles
     const style = document.createElement('style');
     style.textContent = `
       .snapphil-terminal-log {
         position: fixed;
         bottom: 30px;
         left: 50%;
         transform: translateX(-50%);
         width: 520px;
         max-width: 98vw;
         background: #181c20;
         color: #e3e3e3;
         border-radius: 16px;
         box-shadow: 0 8px 32px rgba(0,0,0,0.3);
         z-index: 2147483647;
         font-family: 'SF Mono', Consolas, Monaco, monospace;
         font-size: 12px;
         display: flex;
         flex-direction: column;
         border: 1px solid #222;
         transition: opacity 0.3s, transform 0.3s;
         opacity: 1;
       }
       .snapphil-terminal-log.hidden {
         display: none;
       }
       .terminal-header {
         display: flex;
         align-items: center;
         justify-content: space-between;
         background: #23272e;
         padding: 8px 14px;
         border-radius: 16px 16px 0 0;
         border-bottom: 1px solid #222;
       }
       .terminal-title {
         font-weight: bold;
         color: #f0a830;
         font-size: 13px;
       }
       .terminal-header-btns {
         display: flex;
         gap: 4px;
       }
       .terminal-toggle-btn, .terminal-close-btn {
         background: none;
         border: none;
         color: #aaa;
         font-size: 18px;
         cursor: pointer;
         border-radius: 4px;
         width: 28px;
         height: 28px;
         display: flex;
         align-items: center;
         justify-content: center;
         transition: background 0.2s;
       }
       .terminal-toggle-btn:hover, .terminal-close-btn:hover {
         background: #222;
         color: #fff;
       }
       .terminal-content {
         flex: 1;
         overflow-y: auto;
         padding: 10px 14px 10px 14px;
         background: #181c20;
         border-radius: 0 0 16px 16px;
         max-height: 260px;
       }
       .terminal-log-line {
         margin-bottom: 2px;
         white-space: pre-wrap;
         word-break: break-word;
         display: flex;
         align-items: flex-start;
       }
       .terminal-log-id {
         font-weight: bold;
         margin-right: 6px;
       }
       .terminal-log-info { color: #6ec8ff; }
       .terminal-log-error { color: #ff453a; }
       .terminal-log-success { color: #32d74b; }
       .terminal-log-warning { color: #ffd60a; }
       .terminal-log-system { color: #f0a830; }
       .terminal-log-time {
         color: #888;
         margin-right: 6px;
         font-size: 11px;
         flex-shrink: 0;
       }
     `;
     document.head.appendChild(style);
     document.body.appendChild(overlay);

     // Toggle button - switch to status window
     overlay.querySelector('.terminal-toggle-btn').onclick = () => {
       switchToStatusWindow();
     };
     
     // Close button
     overlay.querySelector('.terminal-close-btn').onclick = () => {
       overlay.classList.add('hidden');
     };

     return overlay;
   }

   // Add a button to the status window to show the terminal log
   function addTerminalToggleToStatusWindow() {
     const slider = document.getElementById('ai-job-assistant-slider');
     if (!slider || slider.querySelector('.terminal-show-btn')) return;
     
     const btn = document.createElement('button');
     btn.className = 'terminal-show-btn';
     btn.title = 'Switch to Terminal Log';
     btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 20 20"><rect width="20" height="20" rx="4" fill="#23272e"/><text x="4" y="15" font-size="12" fill="#f0a830">›_</text></svg>';
     btn.style.position = 'absolute';
     btn.style.top = '10px';
     btn.style.left = '10px';
     btn.style.background = 'none';
     btn.style.border = 'none';
     btn.style.cursor = 'pointer';
     btn.style.zIndex = '2147483648';
     btn.onclick = () => {
       switchToTerminalLog();
     };
     slider.appendChild(btn);
   }

   // Helper function to switch to terminal log
   function switchToTerminalLog() {
     // Hide the status window
     const slider = document.getElementById('ai-job-assistant-slider');
     if (slider) slider.classList.add('hidden');
     
     // Show the terminal log
     const overlay = document.getElementById('snapphil-terminal-log') || createTerminalLogOverlay();
     overlay.classList.remove('hidden');
     renderTerminalLogs();
   }

   // Helper function to switch to status window
   function switchToStatusWindow() {
     // Hide the terminal log
     const terminal = document.getElementById('snapphil-terminal-log');
     if (terminal) terminal.classList.add('hidden');
     
     // Show the status window
     const slider = document.getElementById('ai-job-assistant-slider');
     if (slider) slider.classList.remove('hidden');
   }

   // Render logs in the terminal overlay
   function renderTerminalLogs() {
     const overlay = document.getElementById('snapphil-terminal-log');
     if (!overlay) return;
     const content = overlay.querySelector('.terminal-content');
     if (!content) return;
     content.innerHTML = '';
     (logSystem.logs || []).forEach(log => {
       const line = document.createElement('div');
       line.className = 'terminal-log-line terminal-log-' + log.type;
       line.innerHTML = `<span class="terminal-log-time">${log.timestamp}</span><span class="terminal-log-id">[SnapPhil ${log.type}]</span> <span>${log.message}</span>`;
       content.appendChild(line);
     });
     // Auto-scroll to bottom
     content.scrollTop = content.scrollHeight;
   }

   // Patch logSystem to also update the terminal overlay
   const _originalAdd = logSystem.add;
   logSystem.add = function(message, type = 'info') {
     const entry = _originalAdd.call(this, message, type);
     renderTerminalLogs();
     return entry;
   };

   // Ensure the terminal toggle button is added when the status window is shown
   const _originalShowSlidingWindow = showSlidingWindow;
   showSlidingWindow = function() {
     _originalShowSlidingWindow();
     addTerminalToggleToStatusWindow();
   };

   // Message listener for communication with background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      // On explicit logout event from anywhere (popup, settings), wipe client-only caches that can affect filenames/uploads
      if (message.action === 'auth:logout') {
        try {
          chrome.storage.local.remove([
            'currentCoverLetter', 'lastGeneratedCoverLetter', 'resumeTextContent',
            'applicationHistory', 'recentApplications'
          ]);
        } catch (_) {}
        sendResponse({ status: 'cleared' });
        return true;
      }
     // Add ping handler to check if content script is loaded
     if (message.action === "ping") {
       sendResponse({status: "alive"});
       return true;
     }
     
     if (message.action === "startAutomation") {
       startAutomation(message.settings)
         .then(result => sendResponse(result))
         .catch(error => sendResponse({ status: "error", message: error.message }));
       return true;
     }
     
     if (message.action === "startAutofill") {
       startAutomation(message.settings || {})
         .then(result => sendResponse(result))
         .catch(error => sendResponse({ status: "error", message: error.message }));
       return true;
     }
     
     if (message.action === "showNotification") {
       showToastNotification(message.message, message.type);
       sendResponse({ status: "success" });
       return true;
     }
     
     if (message.action === 'uploadResume') {
       const result = uploadResumeToPage(
         message.resumeData,
         message.resumeName,
         message.resumeType
       );
       sendResponse({ message: result });
       return true;
     }
     
     if (message.action === 'uploadCoverLetter') {
       const coverLetterButton = document.getElementById('cover-letter') ||
                               document.getElementById('coverLetter') ||
                               findUploadButton('coverLetter');
       if (!coverLetterButton) {
         sendResponse({ message: "No cover letter upload button found on this page." });
         return true;
       }
       
       try {
         const content = message.coverLetterContent;
         
         // Ensure filename has .pdf extension instead of .docx
         let filename = message.coverLetterName || "Cover_Letter.pdf";
         if (!filename.toLowerCase().endsWith('.pdf')) {
           filename = filename.replace(/\.[^/.]+$/, "") + ".pdf";
         }
         
         // If we have a data URL, use it directly. Otherwise generate the PDF here.
         let dataUrlPromise;
         if (message.coverLetterDataUrl) {
           dataUrlPromise = Promise.resolve(message.coverLetterDataUrl);
         } else if (message.generatePdf) {
           // Generate PDF in the content script where jsPDF is already loaded
           try {
             console.log("Generating PDF in content script...");
             // Directly assign the promise returned by generatePDFFromText
             dataUrlPromise = generatePDFFromText(content, filename);
           } catch (pdfError) {
             console.error("Error starting PDF generation in content script:", pdfError);
             sendResponse({ message: `Error starting PDF generation: ${pdfError.message}` });
             return true;
           }
         } else {
           sendResponse({ message: "No PDF data provided or generation parameter set" });
           return true;
         }
         
         // Process the data URL (either directly provided or generated)
         dataUrlPromise.then(dataUrl => {
           // Ensure dataUrl is a string before proceeding
           if (typeof dataUrl !== 'string') {
             console.error("Resolved dataUrl is not a string:", dataUrl);
             sendResponse({ message: "Failed to obtain valid PDF data for cover letter." });
             return;
           }

           const result = uploadFileToElement(
             coverLetterButton,
             dataUrl,
             filename,
             'application/pdf',
             "cover letter"
           );
           
           // uploadFileToElement directly returns a string message
           sendResponse({ message: result });

         }).catch(error => {
           console.error("Error processing cover letter dataUrlPromise:", error);
           sendResponse({ message: `Error processing cover letter: ${error.message || 'Unknown error'}` });
         });
         
       } catch (error) {
         console.error("Cover letter processing error:", error);
         sendResponse({ message: `Error processing cover letter: ${error.message}` });
       }
       return true;
     }
     
     // Handle API call progress signals from background script
     if (message.action === "apiCallProgress") {
       if (message.status === "start") {
         applicationState.apiCallInProgress = true;
         applicationState.apiCallStartTime = Date.now();
         applicationState.apiLoadingAnimationId = Math.random().toString(36).substring(2, 15);
          logSystem.info(`OpenAI API call starting with model: ${message.model}`);
          // Show dial, not terminal
          try { canvasDial.show(); } catch(_) {}
         startApiLoadingAnimation(applicationState.apiLoadingAnimationId);
       } 
       else if (message.status === "complete") {
         applicationState.apiCallInProgress = false;
         stopApiLoadingAnimation(applicationState.apiLoadingAnimationId);
          logSystem.success(`OpenAI API call completed in ${message.elapsedTime}s`);
         if (message.preserveLogs) {
           applicationState.preserveLogsOnNextAction = true;
           if (!applicationState._originalExecuteFormActions) {
             applicationState._originalExecuteFormActions = executeFormActions;
             executeFormActions = function(actions) {
               if (applicationState.preserveLogsOnNextAction) {
                  try { canvasDial.show(); } catch(_) {}
                 applicationState.preserveLogsOnNextAction = false;
               }
               return applicationState._originalExecuteFormActions(actions);
             };
           }
         }
       }
       sendResponse({ status: "success" });
       return true;
     }
     
     // Toggle Settings Panel Overlay
     if (message.action === 'toggleSettingsPanel') {
       try {
         toggleSettingsPanel();
         sendResponse({ status: 'toggled' });
       } catch (err) {
         console.error('SnapPhil: Error toggling settings panel', err);
         sendResponse({ status: 'error', message: err.message });
       }
       return true;
     }
     
     return false;
   });
   
   // Helper function to start API loading animation in terminal
   function startApiLoadingAnimation(animationId) {
     if (!animationId) return;
     
     const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
     let frameIndex = 0;
     
     // Store the animation entry in the application state
     const loadingEntry = {
       id: animationId,
       message: 'API call in progress...',
       type: 'info',
       timestamp: new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
       intervalId: setInterval(() => {
         // Calculate elapsed time
         const elapsed = ((Date.now() - applicationState.apiCallStartTime) / 1000).toFixed(1);
         
         // Update the loading animation
         const frame = frames[frameIndex % frames.length];
         const updatedMessage = `${frame} API call in progress... (${elapsed}s elapsed)`;
         
         // Find and update the existing loading log entry if it exists
         const terminalEl = document.getElementById('snapphil-terminal-log');
         if (terminalEl) {
           const content = terminalEl.querySelector('.terminal-content');
           if (content) {
             const loadingLogEntry = content.querySelector(`.loading-animation-${animationId}`);
             if (loadingLogEntry) {
               const messageEl = loadingLogEntry.querySelector('.message');
               if (messageEl) messageEl.textContent = updatedMessage;
             } else {
               // Create a new loading animation entry
               const line = document.createElement('div');
               line.className = `terminal-log-line terminal-log-info loading-animation-${animationId}`;
               line.innerHTML = `
                 <span class="terminal-log-time">${loadingEntry.timestamp}</span>
                 <span class="terminal-log-id">[SnapPhil info]</span> 
                 <span class="message">${updatedMessage}</span>
               `;
               content.appendChild(line);
               content.scrollTop = content.scrollHeight;
             }
           }
         }
         
         frameIndex++;
       }, 100)
     };
     
     // Store in application state
     applicationState.loadingAnimations = applicationState.loadingAnimations || {};
     applicationState.loadingAnimations[animationId] = loadingEntry;
   }
   
   // Helper function to stop the loading animation
   function stopApiLoadingAnimation(animationId) {
     if (!animationId) return;
     
     // Get the animation entry
     const animations = applicationState.loadingAnimations || {};
     const loadingEntry = animations[animationId];
     
     if (loadingEntry && loadingEntry.intervalId) {
       // Clear the interval
       clearInterval(loadingEntry.intervalId);
       
       // Remove the animation entry from the DOM
       const terminalEl = document.getElementById('snapphil-terminal-log');
       if (terminalEl) {
         const content = terminalEl.querySelector('.terminal-content');
         if (content) {
           const loadingLogEntry = content.querySelector(`.loading-animation-${animationId}`);
           if (loadingLogEntry) {
             content.removeChild(loadingLogEntry);
           }
         }
       }
       
       // Remove from the application state
       delete animations[animationId];
     }
   }

  // -------------------------------------------------------------------------
  // Resume Developer Preview Panel
  // -------------------------------------------------------------------------
  const RESUME_PREVIEW_STORAGE_KEY = 'customResumePreview';
const resumePreviewState = {
    mounted: false,
    loading: false,
    observer: null,
    cachedRecord: null,
    elements: null,
    lastPreparedHtml: '',
    acceptInFlight: false,
  renderDelayMs: 700,
  layoutMode: 'stacked',
  inlineResizeObserver: null,
  hydrationWaitAttempts: 0,
  hydrationRetryTimer: null
  };
  let resumePreviewInitStarted = false;

function clearStoredResumePreview() {
  resumePreviewState.cachedRecord = null;
  resumePreviewState.lastPreparedHtml = '';
  chrome.storage.local.remove(RESUME_PREVIEW_STORAGE_KEY, () => {
    console.log('[Resume Developer] Cleared cached preview state');
  });
}

  function ensureResumePreviewStyles() {
    if (document.getElementById('snapphil-resume-preview-style')) return;
    const style = document.createElement('style');
    style.id = 'snapphil-resume-preview-style';
    style.textContent = `
      .snapphil-resume-inline-host {
        display: grid !important;
        grid-template-columns: minmax(0, 1fr) minmax(280px, 340px);
        gap: 20px;
        align-items: flex-start;
        margin: 8px 0 20px;
      }
      .snapphil-resume-inline-host > * {
        min-width: 0;
      }
      .snapphil-resume-inline-host.is-stacked {
        grid-template-columns: minmax(0, 1fr);
      }
      .snapphil-resume-inline-host.is-stacked .snapphil-resume-preview-panel {
        max-width: 100%;
      }
      .snapphil-resume-preview-panel {
        position: relative;
        width: 100%;
        max-width: 340px;
        min-width: 0;
        background: #000000;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        padding: 14px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        pointer-events: auto;
        transition: all 0.25s ease;
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
        margin: 0;
      }
      .snapphil-resume-preview-panel.is-loading {
        opacity: 0.95;
      }
      .snapphil-resume-preview-cta {
        font-size: 12px;
        color: rgba(255, 255, 255, 0.7);
        margin-bottom: 10px;
        cursor: pointer;
        text-decoration: underline;
        text-underline-offset: 2px;
        transition: color 0.2s ease;
        text-align: center;
        padding: 6px;
      }
      .snapphil-resume-preview-cta:hover {
        color: rgba(240, 168, 48, 0.95);
      }
      .snapphil-resume-preview-cta.hidden {
        display: none;
      }
      .snapphil-resume-preview-actions {
        display: flex;
        gap: 8px;
        margin-bottom: 10px;
      }
      .snapphil-resume-preview-actions.hidden {
        display: none;
      }
      .snapphil-resume-preview-button {
        border: none;
        border-radius: 7px;
        height: 34px;
        padding: 0 14px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        font-weight: 500;
        font-size: 12px;
        transition: all 0.2s ease;
        flex: 1;
      }
      .snapphil-resume-preview-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .snapphil-resume-accept {
        background: linear-gradient(90deg, #f0a830, #d89726);
        color: #1c1e26;
        font-weight: 600;
        box-shadow: 0 2px 6px rgba(240, 168, 48, 0.3);
      }
      .snapphil-resume-accept:hover:not(:disabled) {
        background: linear-gradient(90deg, #e6981f, #d49020);
        transform: translateY(-1px);
        box-shadow: 0 3px 10px rgba(240, 168, 48, 0.4);
      }
      .snapphil-resume-accept:active:not(:disabled) {
        transform: translateY(0);
      }
      .snapphil-resume-preview-tailored {
        margin-bottom: 10px;
      }
      .snapphil-resume-preview-tailored.hidden {
        display: none;
      }
      .snapphil-resume-preview-tailored-title {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: rgba(255, 255, 255, 0.6);
        margin-bottom: 6px;
      }
      .snapphil-resume-preview-highlights {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 5px;
      }
      .snapphil-resume-preview-highlights li {
        font-size: 11px;
        padding-left: 14px;
        position: relative;
        color: rgba(255, 255, 255, 0.65);
        line-height: 1.4;
      }
      .snapphil-resume-preview-highlights li::before {
        content: "•";
        position: absolute;
        left: 0;
        color: #f0a830;
        font-weight: bold;
        font-size: 13px;
      }
      .snapphil-resume-preview-frame-wrapper {
        position: relative;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        overflow: hidden;
        background: rgba(20, 20, 20, 0.3);
        min-height: 320px;
        margin-top: 6px;
        padding: 10px;
        transition: all 0.25s ease;
      }
      .snapphil-resume-preview-frame-wrapper:hover {
        border-color: rgba(255, 255, 255, 0.15);
      }
      .snapphil-resume-preview-frame {
        width: 100%;
        height: 600px;
        min-height: 600px;
        border: none;
        background: #fff;
        display: none;
        border-radius: 6px;
        box-shadow: 0 1px 8px rgba(0, 0, 0, 0.12);
        overflow: auto;
      }
      .snapphil-resume-preview-frame.visible {
        display: block;
      }
      .snapphil-resume-preview-empty-state {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        padding: 16px;
        color: rgba(255, 255, 255, 0.45);
        font-size: 12px;
      }
      .snapphil-resume-preview-empty-state.hidden {
        display: none;
      }
      .snapphil-resume-preview-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
        gap: 8px;
      }
      .snapphil-resume-preview-refresh {
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 6px;
        color: rgba(255, 255, 255, 0.85);
        font-size: 11px;
        padding: 6px 10px;
        cursor: pointer;
        transition: all 0.2s ease;
        font-weight: 500;
        display: inline-flex;
        align-items: center;
        gap: 5px;
      }
      .snapphil-resume-preview-refresh:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.15);
        border-color: rgba(255, 255, 255, 0.25);
        color: #f0a830;
      }
      .snapphil-resume-preview-refresh:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .snapphil-resume-format-tabs {
        display: flex;
        gap: 4px;
        background: rgba(255, 255, 255, 0.05);
        border-radius: 6px;
        padding: 3px;
        border: 1px solid rgba(255, 255, 255, 0.1);
      }
      .snapphil-resume-format-tab {
        background: transparent;
        border: none;
        color: rgba(255, 255, 255, 0.6);
        font-size: 11px;
        padding: 5px 10px;
        cursor: pointer;
        border-radius: 4px;
        transition: all 0.2s ease;
        font-weight: 500;
      }
      .snapphil-resume-format-tab:hover:not(.active) {
        background: rgba(255, 255, 255, 0.08);
        color: rgba(255, 255, 255, 0.8);
      }
      .snapphil-resume-format-tab.active {
        background: #f0a830;
        color: #1c1e26;
        font-weight: 600;
      }
      .snapphil-resume-loading-overlay {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.85);
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        z-index: 10;
        border-radius: 8px;
        gap: 12px;
      }
      .snapphil-resume-loading-overlay.hidden {
        display: none;
      }
      .snapphil-loading-wave {
        font-size: 32px;
        animation: wave 1.5s ease-in-out infinite;
      }
      @keyframes wave {
        0%, 100% { transform: rotate(0deg); }
        25% { transform: rotate(20deg); }
        75% { transform: rotate(-20deg); }
      }
      .snapphil-loading-timer {
        font-size: 14px;
        color: #f0a830;
        font-weight: 600;
        font-family: 'Courier New', monospace;
      }
      .snapphil-loading-text {
        font-size: 12px;
        color: rgba(255, 255, 255, 0.7);
      }
      @media (max-width: 1024px) {
        .snapphil-resume-inline-host {
          grid-template-columns: minmax(0, 1fr);
        }
      }
    `;
    document.head.appendChild(style);
  }

  const MAX_HYDRATION_WAIT_ATTEMPTS = 8;

  function nodeHasReactFiber(node) {
    if (!node) return false;
    try {
      const names = Object.getOwnPropertyNames(node);
      return names.some(name => name.startsWith('__reactFiber$'));
    } catch (error) {
      console.warn('[Resume Developer] Unable to inspect node for React hydration markers:', error);
      return false;
    }
  }

  function ensureReactHydrationReady(anchor) {
    if (!anchor) return false;
    if (nodeHasReactFiber(anchor) || nodeHasReactFiber(anchor.parentElement)) {
      resumePreviewState.hydrationWaitAttempts = 0;
      return true;
    }

    if (resumePreviewState.hydrationWaitAttempts >= MAX_HYDRATION_WAIT_ATTEMPTS) {
      console.log('[Resume Developer] Hydration markers not found; proceeding with panel attach.');
      resumePreviewState.hydrationWaitAttempts = 0;
      return true;
    }

    resumePreviewState.hydrationWaitAttempts += 1;
    const delay = Math.min(2000, 300 * resumePreviewState.hydrationWaitAttempts);
    console.log(`[Resume Developer] Host container not hydrated yet (attempt ${resumePreviewState.hydrationWaitAttempts}), retrying in ${delay}ms`);
    clearTimeout(resumePreviewState.hydrationRetryTimer);
    resumePreviewState.hydrationRetryTimer = setTimeout(() => {
      resumePreviewState.hydrationRetryTimer = null;
      attachResumePreviewPanel();
    }, delay);
    return false;
  }

  function hasUploadControls(node) {
    if (!node) return false;
    const fileInputs = node.querySelectorAll('input[type="file"], button, a');
    return Array.from(fileInputs).some(el => {
      const text = (el.textContent || '').toLowerCase();
      return text.includes('attach') || text.includes('upload') || text.includes('resume') || el.type === 'file';
    });
  }

  function findNearestUploadAncestor(node) {
    let current = node;
    while (current && current !== document.body) {
      if (hasUploadControls(current)) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  function normalizeResumeAnchor(anchor) {
    if (!anchor || anchor === document.body || anchor === document.documentElement) {
      return anchor;
    }
    const rect = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
    if (!rect) return anchor;

    // If the container spans most of the viewport, try to shrink to the upload field wrapper
    if (rect.width > 680) {
      const uploadInput = anchor.querySelector('input[type="file"]');
      if (uploadInput) {
        const uploadHost =
          uploadInput.closest('.application-question, .application-form-section, .form-field, .field, .form-group, .upload-field, .file-upload, .attachment-field, fieldset, section') ||
          uploadInput.parentElement;
        if (uploadHost && uploadHost !== document.body && uploadHost !== document.documentElement && uploadHost !== anchor) {
          console.log('[Resume Developer] Refined anchor to upload field container:', uploadHost.tagName, uploadHost.className);
          return uploadHost;
        }
      }
    }
    return anchor;
  }

  function determineHostContainer(anchor) {
    if (!anchor) return null;
    let host = anchor;
    if (['LABEL', 'SPAN', 'BUTTON', 'P'].includes(host.tagName)) {
      const preferred =
        host.closest('.application-question, .application-form-section, .form-field, .field, .form-group, .upload-field, .file-upload, fieldset, section') ||
        host.parentElement;
      if (preferred) host = preferred;
    }
    if (host === document.body || host === document.documentElement) {
      const fallback = anchor.closest('.application-question, .application-form-section, .form-field, .field, .form-group, .upload-field, .file-upload, fieldset, section');
      if (fallback && fallback !== document.body && fallback !== document.documentElement) {
        host = fallback;
      }
    }
    return host;
  }

  function findResumeSectionAnchor() {
    const textMatchers = [
      'resume',
      'résumé',
      'curriculum vitae',
      'cv'
    ];
    const selectors = [
      'label',
      'legend',
      'h2',
      'h3',
      'h4',
      'p',
      'span',
      '[data-testid]',
      '[data-test]',
      'div'
    ];
    const priorityContainers = [
      'fieldset',
      'section',
      '.application-question',
      '.application-form-section',
      '.form-field',
      '.field',
      '.form-group'
    ];

    const matches = selectors
      .map(selector => Array.from(document.querySelectorAll(selector)))
      .flat()
      .filter(el => {
        if (!el || !el.textContent) return false;
        const text = el.textContent.trim().toLowerCase();
        return text && textMatchers.some(word => text.includes(word));
      });

    console.log('[Resume Developer] Found potential matches:', matches.length);
    if (!matches.length) {
      console.log('[Resume Developer] No Resume/CV section found on page');
      return null;
    }

    const anchor = matches
      .map(match => {
        const uploadAncestor = findNearestUploadAncestor(match);
        if (uploadAncestor) return uploadAncestor;
        const preferred = priorityContainers
          .map(selector => match.closest(selector))
          .find(Boolean);
        return preferred || match.closest('div, form') || match.parentElement;
      })
      .find(candidate => candidate && hasUploadControls(candidate));

    const fallbackAnchor = matches[0] ? matches[0].closest('div, form') || matches[0].parentElement : null;
    const resolvedAnchor = normalizeResumeAnchor(anchor || fallbackAnchor);

    if (!resolvedAnchor) {
      console.log('[Resume Developer] No suitable container found');
      return null;
    }
    if (resolvedAnchor.dataset.snapphilResumePreview === 'true') {
      console.log('[Resume Developer] Panel already attached');
      return null;
    }

    console.log('[Resume Developer] Found anchor element:', resolvedAnchor.tagName, resolvedAnchor.className);
    return resolvedAnchor;
  }

  function updateCtaText() {
    const ctaEl = resumePreviewState.elements?.ctaEl;
    if (!ctaEl) return;
    
    const count = resumePreviewState.generationCount || 0;
    if (count === 0) {
      ctaEl.innerHTML = 'Want to customize the resume? <strong>Click here</strong>';
    } else if (count === 1) {
      ctaEl.innerHTML = 'If you don\'t like it, let us <strong>retry</strong>';
    } else if (count === 2) {
      ctaEl.innerHTML = 'One more try? <strong>Regenerate</strong>';
    } else {
      ctaEl.innerHTML = 'Still not satisfied? <strong>Try again</strong>';
    }
  }

  function setResumePreviewLoading(isLoading) {
    resumePreviewState.loading = isLoading;
    const panel = resumePreviewState.elements?.panelEl;
    const ctaEl = resumePreviewState.elements?.ctaEl;
    const actionsEl = resumePreviewState.elements?.actionsEl;
    const tailoredEl = resumePreviewState.elements?.tailoredEl;
    const loadingOverlay = resumePreviewState.elements?.loadingOverlay;
    const loadingTimer = resumePreviewState.elements?.loadingTimer;
    const refreshBtn = resumePreviewState.elements?.refreshBtn;
    
    if (panel) {
      panel.classList.toggle('is-loading', isLoading);
    }
    if (ctaEl) {
      ctaEl.style.opacity = isLoading ? '0.5' : '1';
      ctaEl.style.pointerEvents = isLoading ? 'none' : 'auto';
    }
    if (actionsEl) {
      actionsEl.classList.toggle('hidden', isLoading || !resumePreviewState.lastPreparedHtml);
    }
    if (tailoredEl) {
      tailoredEl.classList.toggle('hidden', isLoading || !resumePreviewState.lastPreparedHtml);
    }
    if (resumePreviewState.elements?.acceptBtn) {
      resumePreviewState.elements.acceptBtn.disabled = isLoading || resumePreviewState.acceptInFlight || !resumePreviewState.lastPreparedHtml;
    }
    if (refreshBtn) {
      refreshBtn.disabled = isLoading;
    }
    
    // Handle loading overlay with timer
    if (loadingOverlay) {
      loadingOverlay.classList.toggle('hidden', !isLoading);
    }
    
    // Clear any existing timer
    if (resumePreviewState.loadingTimerInterval) {
      clearInterval(resumePreviewState.loadingTimerInterval);
      resumePreviewState.loadingTimerInterval = null;
    }
    
    if (isLoading && loadingTimer) {
      // Start timer
      let seconds = 0;
      loadingTimer.textContent = '0s';
      resumePreviewState.loadingTimerInterval = setInterval(() => {
        seconds++;
        loadingTimer.textContent = seconds + 's';
      }, 1000);
    }
  }

  function updateResumePreviewHighlights(tailoringExplanations) {
    const list = resumePreviewState.elements?.highlightsEl;
    if (!list) return;
    list.innerHTML = '';
    if (!tailoringExplanations || !tailoringExplanations.length) {
      const placeholder = document.createElement('li');
      placeholder.textContent = "Tailoring changes will be explained here.";
      list.appendChild(placeholder);
      return;
    }
    tailoringExplanations.slice(0, 5).forEach(item => {
      const li = document.createElement('li');
      li.textContent = item;
      list.appendChild(li);
    });
  }

  function convertHtmlToPlainText(html) {
    // Create a temporary div to parse HTML
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    
    // Remove script and style elements
    const scripts = tempDiv.getElementsByTagName('script');
    const styles = tempDiv.getElementsByTagName('style');
    for (let i = scripts.length - 1; i >= 0; i--) {
      scripts[i].remove();
    }
    for (let i = styles.length - 1; i >= 0; i--) {
      styles[i].remove();
    }
    
    // Get text content and clean it up
    let text = tempDiv.textContent || tempDiv.innerText || '';
    
    // Clean up excessive whitespace while preserving structure
    text = text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join('\n');
    
    return text;
  }

  function downloadTextCopy(textContent, filename) {
    if (!textContent || typeof textContent !== 'string') return;
    try {
      const blob = new Blob([textContent], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename || `tailored-resume-${Date.now()}.txt`;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      console.log('[Resume Developer] Downloaded text copy:', anchor.download);
    } catch (error) {
      console.error('[Resume Developer] Failed to download text copy:', error);
    }
  }

  function downloadPdfCopy(dataUrl, filename) {
    if (!dataUrl || typeof dataUrl !== 'string') return;
    try {
      const anchor = document.createElement('a');
      anchor.href = dataUrl;
      anchor.download = filename || `tailored-resume-${Date.now()}.pdf`;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      console.log('[Resume Developer] Downloaded PDF copy:', anchor.download);
    } catch (error) {
      console.error('[Resume Developer] Failed to download PDF copy:', error);
    }
  }

  function applyPreviewFitStyles(iframe) {
    try {
      const doc = iframe?.contentDocument;
      if (!doc || doc.getElementById('snapphil-preview-fit-styles')) return;
      const style = doc.createElement('style');
      style.id = 'snapphil-preview-fit-styles';
      style.textContent = `
        html {
          margin: 0 !important;
          padding: 0 !important;
          background: #f5f5f5;
          overflow-x: hidden;
        }
        body {
          margin: 0 !important;
          padding: 0.5in !important;
          background: #fff;
          width: 100% !important;
          max-width: 100% !important;
          box-sizing: border-box;
          overflow-x: hidden;
        }
      `;
      (doc.head || doc.documentElement).appendChild(style);
    } catch (error) {
      console.warn('[Resume Developer] Unable to inject preview fit styles:', error);
    }
  }

  function decodeHtmlEntities(rawHtml) {
    if (rawHtml == null) return '';
    let decoded = typeof rawHtml === 'string' ? rawHtml : String(rawHtml);
    const namedEntities = [
      ['&nbsp;', ' '],
      ['&lt;', '<'],
      ['&gt;', '>'],
      ['&quot;', '"'],
      ['&#34;', '"'],
      ['&#39;', "'"],
      ['&#x27;', "'"],
      ['&#96;', '`'],
      ['&#x2F;', '/'],
      ['&frasl;', '/'],
      ['&amp;', '&']
    ];

    for (let pass = 0; pass < 3; pass++) {
      let next = decoded
        .replace(/&#(\d+);/g, (match, code) => {
          const num = parseInt(code, 10);
          return Number.isFinite(num) ? String.fromCharCode(num) : match;
        })
        .replace(/&#x([0-9a-f]+);/gi, (match, hex) => {
          const num = parseInt(hex, 16);
          return Number.isFinite(num) ? String.fromCharCode(num) : match;
        });

      namedEntities.forEach(([entity, char]) => {
        next = next.replace(new RegExp(entity, 'gi'), char);
      });

      if (next === decoded) break;
      decoded = next;
    }

    return decoded;
  }

  function normalizeResumeDocument(doc) {
    if (!doc || !doc.body) return;

    // Remove "What was tailored" section (resume shouldn't include this block)
    doc.querySelectorAll('.section').forEach(section => {
      const title = section.querySelector('.section-title');
      if (title && title.textContent.trim().toUpperCase().includes('WHAT WAS TAILORED')) {
        section.remove();
      }
    });

    // Normalize contact line into stacked spans for better wrapping
    const contactEl = doc.querySelector('.header-contact');
    if (contactEl) {
      const text = contactEl.textContent.replace(/\s+/g, ' ').trim();
      const pieces = text.split(/[\u2022•|·]+/).map(part => part.trim()).filter(Boolean);
      if (pieces.length > 1) {
        contactEl.innerHTML = pieces.map(part => `<span>${part}</span>`).join('');
        contactEl.classList.add('multi-line');
      }
    }

    // Standardize wording for project section titles
    doc.querySelectorAll('.section-title').forEach(title => {
      const upper = title.textContent.trim().toUpperCase();
      if (upper.includes('GENAI')) {
        title.textContent = upper.replace('GENAI', 'GEN AI');
      } else {
        title.textContent = upper;
      }
    });

    // Replace em-dashes with spaced en-dashes for consistency
    const dashTargets = doc.querySelectorAll('li, p, .exp-item, .proj-item, .header-note, .exp-title, .section-title');
    dashTargets.forEach(node => {
      node.innerHTML = node.innerHTML.replace(/—/g, ' – ').replace(/\s{2,}/g, ' ');
    });

    // Remove any strikethrough tags that leak into the final resume
    doc.querySelectorAll('s, del, strike').forEach(node => {
      const span = doc.createElement('span');
      span.innerHTML = node.innerHTML;
      node.replaceWith(span);
    });
  }

  function normalizeResumeHtml(html) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      if (!doc || !doc.documentElement) return html;
      normalizeResumeDocument(doc);
      const doctype = '<!DOCTYPE html>';
      return `${doctype}\n${doc.documentElement.outerHTML}`;
    } catch (error) {
      console.warn('[Resume Developer] Failed to normalize resume HTML:', error);
      return html;
    }
  }

  function prepareResumeHtml(rawHtml) {
    const normalizedHtml = decodeHtmlEntities(rawHtml || '');
    const trimmed = normalizedHtml.trim();
    if (!trimmed) return '';
    
    if (/<html/i.test(trimmed) || /<!DOCTYPE/i.test(trimmed)) {
      return normalizeResumeHtml(trimmed);
    }

    if (/<[a-z][\s\S]*>/i.test(trimmed)) {
      const fallbackCss = `
        body { font-family: "Helvetica Neue", Arial, sans-serif; margin: 0; padding: 36px 42px; color: #111; line-height: 1.4; background: #fff; }
        h1 { font-size: 26px; margin-bottom: 4px; }
        h2 { font-size: 16px; margin-top: 18px; border-bottom: 1px solid #ccc; padding-bottom: 3px; letter-spacing: 0.05em; }
        ul { margin: 6px 0 12px 18px; padding-left: 4px; }
        li { margin-bottom: 4px; }
      `;
      
      const wrapped = `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="utf-8" />
            <style>${fallbackCss}</style>
          </head>
          <body>
            ${trimmed}
          </body>
        </html>
      `;
      return normalizeResumeHtml(wrapped);
    }

    // Plain text - parse for CSS and wrap in paragraphs
    let cssSection = '';
    let bodySection = trimmed;
    const commentIdx = trimmed.indexOf('/*');
    if (commentIdx !== -1) {
      cssSection = trimmed.slice(commentIdx).trim();
      bodySection = trimmed.slice(0, commentIdx).trim();
    }

    const paragraphBlocks = bodySection
      .split(/\n{2,}/)
      .map(chunk => `<p>${chunk.replace(/\n/g, '<br>')}</p>`)
      .join('');

    const fallbackCss = `
      body { font-family: "Helvetica Neue", Arial, sans-serif; margin: 0; padding: 36px 42px; color: #111; line-height: 1.4; background: #fff; }
      h1 { font-size: 26px; margin-bottom: 4px; }
      h2 { font-size: 16px; margin-top: 18px; border-bottom: 1px solid #ccc; padding-bottom: 3px; letter-spacing: 0.05em; }
      ul { margin: 6px 0 12px 18px; padding-left: 4px; }
      li { margin-bottom: 4px; }
    `;

    const basicHtml = `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <style>${fallbackCss}${cssSection}</style>
        </head>
        <body>
          <div class="resume-wrapper">
            ${paragraphBlocks}
          </div>
        </body>
      </html>
    `;
    return normalizeResumeHtml(basicHtml);
  }


  function renderPdfWithHtml2Pdf(preparedHtml) {
    return new Promise((resolve, reject) => {
      const html2pdfLib = window.html2pdf || (typeof html2pdf !== 'undefined' ? html2pdf : undefined);
      if (!html2pdfLib) {
        reject(new Error("html2pdf library not available"));
        return;
      }

      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.left = '-9999px';
      iframe.style.top = '0';
      iframe.style.width = '816px';
      iframe.style.height = '1056px';
      iframe.style.opacity = '0';
      iframe.style.pointerEvents = 'none';
      iframe.style.border = '0';
      iframe.style.visibility = 'hidden';
      iframe.style.zIndex = '-9999';
      iframe.setAttribute('aria-hidden', 'true');
      iframe.tabIndex = -1;

      const parentNode = document.body || document.documentElement;
      if (!parentNode) {
        reject(new Error("Document body not ready for PDF export"));
        return;
      }

      const cleanup = () => {
        iframe.removeEventListener('load', handleLoad);
        if (iframe.parentNode) {
          iframe.parentNode.removeChild(iframe);
        }
      };

      const handleLoad = async () => {
        try {
          const iframeDoc = iframe.contentDocument;
          if (!iframeDoc || !iframeDoc.body) {
            throw new Error("Temporary resume document unavailable");
          }

          // Wait a bit for fonts and layout to settle
          await new Promise(r => setTimeout(r, 300));

          iframeDoc.documentElement.style.background = '#ffffff';
          iframeDoc.body.style.margin = '0';
          iframeDoc.body.style.padding = '0';
          iframeDoc.body.style.background = '#ffffff';

          const scale = 2;
          const worker = html2pdfLib().set({
            margin: 0,
            filename: 'tailored-resume.pdf',
            html2canvas: {
              scale,
              useCORS: true,
              allowTaint: false,
              backgroundColor: '#ffffff',
              logging: false,
              letterRendering: true,
              imageTimeout: 0,
              removeContainer: true,
              windowWidth: 816,
              windowHeight: 1056,
              scrollX: 0,
              scrollY: 0,
              x: 0,
              y: 0
            },
            jsPDF: {
              unit: 'pt',
              format: [816, 1056],
              orientation: 'portrait',
              compress: true
            },
            pagebreak: {
              mode: ['avoid-all', 'css', 'legacy'],
              avoid: ['img', 'tr', 'li']
            }
          }).from(iframeDoc.body);

          const pdfDataUri = await worker.outputPdf('datauristring');
          console.log('[Resume Developer] PDF generated via html2pdf');
          cleanup();
          resolve(pdfDataUri);
        } catch (error) {
          cleanup();
          reject(error);
        }
      };

      iframe.addEventListener('load', handleLoad, { once: true });
      parentNode.appendChild(iframe);
      iframe.srcdoc = preparedHtml;
    });
  }

  async function generatePdfFromHtml(preparedHtml) {
    if (!preparedHtml) throw new Error("No resume HTML available");
    
    console.log('[Resume Developer] Starting PDF generation...');
    await loadRequiredLibraries();
    console.log('[Resume Developer] Libraries loaded, checking for html2pdf...');

    // Wait for the library to be available in the global scope
    let attempts = 0;
    while (attempts < 30) {
      const html2pdfLib = window.html2pdf || (typeof html2pdf !== 'undefined' ? html2pdf : undefined);
      if (html2pdfLib) {
        console.log('[Resume Developer] html2pdf library found, generating PDF...');
        return await renderPdfWithHtml2Pdf(preparedHtml);
      }
      
      if (attempts === 0) {
        console.log('[Resume Developer] Waiting for html2pdf to become available...');
      }
      
      if (attempts % 10 === 9) {
        console.warn(`[Resume Developer] Still waiting for html2pdf... (attempt ${attempts + 1}/30)`);
      }
      
      await new Promise(r => setTimeout(r, 100));
      attempts++;
    }

    console.error('[Resume Developer] html2pdf library failed to load after 3 seconds');
    console.error('[Resume Developer] window.html2pdf:', typeof window.html2pdf);
    console.error('[Resume Developer] html2pdf:', typeof html2pdf);
    
    // Check if script element exists
    const scriptEl = document.querySelector('script[data-snapphil-lib="html2pdf"]');
    if (scriptEl) {
      console.error('[Resume Developer] Script element found, state:', scriptEl.dataset.loadState);
      console.error('[Resume Developer] Script src:', scriptEl.src);
    } else {
      console.error('[Resume Developer] Script element not found in DOM');
    }

    throw new Error("html2pdf library not available - PDF generation is not possible");
  }


  async function handleResumeAcceptClick() {
    if (resumePreviewState.acceptInFlight || !resumePreviewState.lastPreparedHtml) {
      return;
    }

    const selectedFormat = resumePreviewState.selectedFormat || 'txt';
    resumePreviewState.acceptInFlight = true;
    
    if (resumePreviewState.elements?.acceptBtn) {
      resumePreviewState.elements.acceptBtn.disabled = true;
      resumePreviewState.elements.acceptBtn.textContent = selectedFormat === 'txt' ? 'Downloading...' : 'Uploading...';
    }

    try {
      const baseFilename = resumePreviewState.cachedRecord?.meta?.pdfFileName || `tailored-resume-${Date.now()}`;
      const filenameWithoutExt = baseFilename.replace(/\.(pdf|txt)$/i, '');
      
      if (selectedFormat === 'txt') {
        // Download as text file
        const textContent = convertHtmlToPlainText(resumePreviewState.lastPreparedHtml);
        const filename = `${filenameWithoutExt}.txt`;
        downloadTextCopy(textContent, filename);
        
        // Also try to upload if possible (some platforms accept .txt resumes)
        const uploadElement = findUploadButton('resume');
        if (uploadElement) {
          try {
            const blob = new Blob([textContent], { type: 'text/plain' });
            const reader = new FileReader();
            reader.onload = function() {
              const textDataUrl = reader.result;
              uploadFileToElement(
                uploadElement,
                textDataUrl,
                filename,
                'text/plain',
                'resume'
              );
            };
            reader.readAsDataURL(blob);
          } catch (uploadError) {
            console.log('[Resume Developer] Text file downloaded, upload not supported on this platform');
          }
        } else {
          console.log('[Resume Developer] Text file downloaded successfully');
        }
      } else {
        // Download and upload as PDF
        const pdfDataUrl = await generatePdfFromHtml(resumePreviewState.lastPreparedHtml);
        const filename = `${filenameWithoutExt}.pdf`;
        downloadPdfCopy(pdfDataUrl, filename);
        
        const uploadElement = findUploadButton('resume');
        if (!uploadElement) {
          throw new Error("Could not locate the Resume/CV upload field on this page.");
        }

        const resultMessage = uploadFileToElement(
          uploadElement,
          pdfDataUrl,
          filename,
          'application/pdf',
          'resume'
        );

        if (typeof resultMessage === 'string' && resultMessage.toLowerCase().includes('success')) {
          console.log('[Resume Developer] Custom resume uploaded successfully');
        } else {
          console.warn('[Resume Developer] Upload completed with warnings:', resultMessage);
        }
      }
    } catch (error) {
      console.error('[Resume Developer] Accept failed:', error);
    } finally {
      resumePreviewState.acceptInFlight = false;
      if (resumePreviewState.elements?.acceptBtn) {
        resumePreviewState.elements.acceptBtn.disabled = false;
        resumePreviewState.elements.acceptBtn.textContent = 'Download & Upload';
      }
    }
  }

  function renderResumePreview(html, meta, highlights) {
    if (!resumePreviewState.elements) return;
    const iframe = resumePreviewState.elements.iframeEl;
    const emptyState = resumePreviewState.elements.emptyStateEl;
    const actionsEl = resumePreviewState.elements.actionsEl;
    const tailoredEl = resumePreviewState.elements.tailoredEl;

    if (html) {
      const preparedHtml = prepareResumeHtml(html);
      resumePreviewState.lastPreparedHtml = preparedHtml;
      resumePreviewState.generationCount = (resumePreviewState.generationCount || 0) + 1;
      
      iframe.srcdoc = preparedHtml;
      iframe.classList.add('visible');
      emptyState.classList.add('hidden');
      actionsEl?.classList.remove('hidden');
      tailoredEl?.classList.remove('hidden');
      updateCtaText();
    } else {
      iframe.removeAttribute('srcdoc');
      iframe.classList.remove('visible');
      emptyState.classList.remove('hidden');
      actionsEl?.classList.add('hidden');
      tailoredEl?.classList.add('hidden');
      resumePreviewState.lastPreparedHtml = '';
      updateCtaText();
    }

    updateResumePreviewHighlights(meta?.tailoringExplanations || []);
  }

  function hydrateResumePreview(record) {
    resumePreviewState.cachedRecord = record || null;
    if (!resumePreviewState.mounted || !record?.html) {
      if (resumePreviewState.mounted) {
        renderResumePreview('', null, null);
      }
      return;
    }
    renderResumePreview(record.html, record.meta, null);
  }

  function loadStoredResumePreview() {
    chrome.storage.local.get([RESUME_PREVIEW_STORAGE_KEY], (result) => {
      const record = result[RESUME_PREVIEW_STORAGE_KEY];
      hydrateResumePreview(record);
    });
  }

  function guessJobContext() {
    const titleEl = document.querySelector('[data-testid*="job-title"], h1, .job-title, .posting-headline');
    const companyEl = document.querySelector('[data-testid*="company"], .company, .company-name, [itemprop="hiringOrganization"]');
    const locationEl = document.querySelector('[data-testid*="location"], .location, .job-location, [itemprop="jobLocation"]');

    return {
      jobTitle: titleEl?.textContent?.trim() || '',
      companyName: companyEl?.textContent?.trim() || '',
      location: locationEl?.textContent?.trim() || '',
      jobUrl: window.location.href
    };
  }

  function buildResumePreviewPayload() {
    const jobContext = guessJobContext();
    const jobRequirements = getPageText();
    return {
      action: "generateCustomResumePreview",
      jobRequirements,
      pageText: jobRequirements,
      jobTitle: jobContext.jobTitle,
      companyName: jobContext.companyName,
      location: jobContext.location,
      jobUrl: jobContext.jobUrl
    };
  }

  function triggerResumePreviewRefresh() {
    if (resumePreviewState.loading) return;
    setResumePreviewLoading(true);
    const payload = buildResumePreviewPayload();

    chrome.runtime.sendMessage(payload, (response) => {
      setResumePreviewLoading(false);
      if (chrome.runtime.lastError) {
        console.error("Resume preview request failed:", chrome.runtime.lastError.message);
        return;
      }
      if (!response || response.error) {
        const message = response?.message || "Unable to generate tailored resume";
        console.error("Resume preview API error:", message);
        return;
      }

      if (response.html) {
        resumePreviewState.cachedRecord = {
          html: response.html,
          meta: response.meta,
          tailoringExplanations: response.tailoringExplanations
        };
        setTimeout(() => {
          renderResumePreview(response.html, response.meta, null);
        }, resumePreviewState.renderDelayMs);
      }
    });
  }

  function attachResumePreviewPanel() {
    if (resumePreviewState.mounted) {
      console.log('[Resume Developer] Panel already mounted');
      return true;
    }
    const anchor = findResumeSectionAnchor();
    if (!anchor) {
      console.log('[Resume Developer] Cannot attach panel - no anchor found');
      return false;
    }
    if (!ensureReactHydrationReady(anchor)) {
      return false;
    }

    console.log('[Resume Developer] Attaching preview panel...');
    ensureResumePreviewStyles();

    const panel = document.createElement('section');
    panel.className = 'snapphil-resume-preview-panel';
    panel.innerHTML = `
      <div class="snapphil-resume-preview-header">
        <button class="snapphil-resume-preview-refresh" aria-label="Refresh tailored resume">
          <span>🔄</span> Refresh
        </button>
        <div class="snapphil-resume-format-tabs">
          <button class="snapphil-resume-format-tab active" data-format="txt">.txt</button>
          <button class="snapphil-resume-format-tab" data-format="pdf">.pdf</button>
        </div>
      </div>
      <div class="snapphil-resume-preview-cta" data-cta-state="initial">Want to customize the resume? <strong>Click here</strong></div>
      <div class="snapphil-resume-preview-actions hidden">
        <button class="snapphil-resume-preview-button snapphil-resume-accept" aria-label="Accept and upload">
          Download & Upload
        </button>
      </div>
      <div class="snapphil-resume-preview-tailored hidden">
        <div class="snapphil-resume-preview-tailored-title">What was tailored?</div>
        <ul class="snapphil-resume-preview-highlights">
          <li>Highlights will appear after generation.</li>
        </ul>
      </div>
      <div class="snapphil-resume-preview-frame-wrapper">
        <iframe class="snapphil-resume-preview-frame" sandbox="allow-same-origin"></iframe>
        <div class="snapphil-resume-preview-empty-state">Your tailored resume will appear here.</div>
        <div class="snapphil-resume-loading-overlay hidden">
          <div class="snapphil-loading-wave">👋</div>
          <div class="snapphil-loading-timer">0s</div>
          <div class="snapphil-loading-text">Generating tailored resume...</div>
        </div>
      </div>
    `;
    anchor.dataset.snapphilResumePreview = 'true';
    const hostContainer = determineHostContainer(anchor) || anchor;
    const applyInlineLayout =
      hostContainer &&
      hostContainer !== document.body &&
      hostContainer !== document.documentElement;
    if (applyInlineLayout) {
      hostContainer.dataset.snapphilResumePreviewHost = 'true';
      hostContainer.classList.add('snapphil-resume-inline-host', 'is-stacked');
    } else {
      console.warn('[Resume Developer] Host container fallback hit; panel will stack below field.');
    }
    anchor.insertAdjacentElement('afterend', panel);

    resumePreviewState.mounted = true;
    resumePreviewState.generationCount = 0;
    resumePreviewState.selectedFormat = 'txt'; // Default format
    resumePreviewState.elements = {
      anchorEl: anchor,
      hostEl: hostContainer,
      panelEl: panel,
      ctaEl: panel.querySelector('.snapphil-resume-preview-cta'),
      actionsEl: panel.querySelector('.snapphil-resume-preview-actions'),
      tailoredEl: panel.querySelector('.snapphil-resume-preview-tailored'),
      acceptBtn: panel.querySelector('.snapphil-resume-accept'),
      highlightsEl: panel.querySelector('.snapphil-resume-preview-highlights'),
      iframeEl: panel.querySelector('.snapphil-resume-preview-frame'),
      emptyStateEl: panel.querySelector('.snapphil-resume-preview-empty-state'),
      refreshBtn: panel.querySelector('.snapphil-resume-preview-refresh'),
      formatTabs: panel.querySelectorAll('.snapphil-resume-format-tab'),
      loadingOverlay: panel.querySelector('.snapphil-resume-loading-overlay'),
      loadingTimer: panel.querySelector('.snapphil-loading-timer')
    };

    resumePreviewState.elements.ctaEl?.addEventListener('click', triggerResumePreviewRefresh);
    resumePreviewState.elements.acceptBtn?.addEventListener('click', handleResumeAcceptClick);
    resumePreviewState.elements.iframeEl?.addEventListener('load', () => applyPreviewFitStyles(resumePreviewState.elements.iframeEl));
    resumePreviewState.elements.refreshBtn?.addEventListener('click', triggerResumePreviewRefresh);
    
    // Format tab switching
    resumePreviewState.elements.formatTabs?.forEach(tab => {
      tab.addEventListener('click', () => {
        const format = tab.dataset.format;
        resumePreviewState.selectedFormat = format;
        resumePreviewState.elements.formatTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
      });
    });

    function updateInlineLayoutMode() {
      const hostEl = resumePreviewState.elements?.hostEl;
      if (!hostEl || hostEl === document.body || hostEl === document.documentElement) return;
      const availableWidth = hostEl.getBoundingClientRect().width;
      const shouldStack = availableWidth < 900 || window.innerWidth < 1100;
      resumePreviewState.layoutMode = shouldStack ? 'stacked' : 'inline';
      hostEl.classList.toggle('is-stacked', shouldStack);
    }
    const handleResize = () => updateInlineLayoutMode();
    window.addEventListener('resize', handleResize, { passive: true });
    if (window.ResizeObserver) {
      resumePreviewState.inlineResizeObserver?.disconnect?.();
      resumePreviewState.inlineResizeObserver = new ResizeObserver(() => updateInlineLayoutMode());
      resumePreviewState.inlineResizeObserver.observe(resumePreviewState.elements.hostEl);
    }
    updateInlineLayoutMode();

    setTimeout(() => {
      updateInlineLayoutMode();
      const panelRect = panel.getBoundingClientRect();
      console.log('[Resume Developer] ✅ Panel successfully attached!');
      console.log('[Resume Developer] Panel dimensions:', {
        width: panelRect.width,
        height: panelRect.height,
        top: panelRect.top,
        left: panelRect.left,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        layoutMode: resumePreviewState.layoutMode
      });
    }, 150);

    updateCtaText();

    return true;
  }

  function observeResumeSection() {
    if (resumePreviewState.observer || document.readyState === 'loading') return;
    resumePreviewState.observer = new MutationObserver(() => {
      if (!resumePreviewState.mounted) {
        attachResumePreviewPanel();
      }
    });
    resumePreviewState.observer.observe(document.body, { childList: true, subtree: true });
  }

  function initResumeDeveloperPanel() {
    if (resumePreviewInitStarted) {
      console.log('[Resume Developer] Init already started');
      return;
    }
    resumePreviewInitStarted = true;
    console.log('[Resume Developer] 🚀 Initializing Resume Developer feature...');
    
    clearStoredResumePreview();
    ensureResumePreviewStyles();
    const attached = attachResumePreviewPanel();
    if (!attached) {
      console.log('[Resume Developer] Failed to attach initially, will retry via observer');
    }
    observeResumeSection();
    loadStoredResumePreview();

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[RESUME_PREVIEW_STORAGE_KEY]) {
        const newValue = changes[RESUME_PREVIEW_STORAGE_KEY].newValue;
        hydrateResumePreview(newValue);
      }
    });
  }

  if (document.readyState === 'complete') {
    console.log('[Resume Developer] Document ready, initializing...');
    initResumeDeveloperPanel();
  } else {
    console.log('[Resume Developer] Waiting for document load...');
    window.addEventListener('load', initResumeDeveloperPanel, { once: true });
    setTimeout(initResumeDeveloperPanel, 2000);
  }
 })();

