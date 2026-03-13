/**
 * StovScanner_API - STOVEScanner 웹 연동 백그라운드 API
 * 모든 백그라운드 로직을 세분화된 함수 형태로 제공.
 * UI 요소는 HTML에서 관리하며, 본 API는 데이터 조회/캐시/로직만 담당.
 */
(function (global) {
    'use strict';

    const CACHE_KEYS = {
        CACHED_DATA: 'stovescanner_cachedData',
        CACHED_AT: 'stovescanner_cachedAt',
    };

    const StovScanner_API = {
        config: {
            apiBase: 'http://127.0.0.1:8080/stovescanner',
            pollIntervalMs: 1000,
            maxWaitMs: 10000,
            minPopupDisplayMs: 1500,
            installUrl: 'https://ysbaek82.github.io/SGScannerTest/STOVEScanner-win-Setup.exe',
            cacheMaxAgeMs: 30 * 24 * 60 * 60 * 1000,
            overlayId: 'loadingOverlay',
            popupContentId: 'popupContent',
            contentId: 'content',
            specIds: { os: 'spec-os', cpu: 'spec-cpu', ram: 'spec-ram', gpu: 'spec-gpu', disk: 'spec-disk' },
        },

        _countdownInterval: null,

        /** 팝업 표시 (로딩 상태) */
        _showPopup() {
            if (typeof window.StovScanner_showPopup === 'function') {
                window.StovScanner_showPopup(this.config.maxWaitMs);
            }
        },

        /** 팝업에 설치 링크·다시시도 버튼 추가 (checkHealth 실패 시) */
        _setPopupInstallState() {
            if (typeof window.StovScanner_setPopupInstallState === 'function') {
                window.StovScanner_setPopupInstallState(this.config.installUrl);
            }
        },

        /** 팝업 숨김 */
        _hidePopup() {
            if (typeof window.StovScanner_hidePopup === 'function') {
                window.StovScanner_hidePopup();
            }
        },

        /** 캐시에서 데이터 조회 (30일 유효) */
        getCachedData() {
            try {
                const raw = localStorage.getItem(CACHE_KEYS.CACHED_DATA);
                const cachedAt = parseInt(localStorage.getItem(CACHE_KEYS.CACHED_AT) || '0', 10);
                if (!raw || !cachedAt) return null;
                if (Date.now() - cachedAt > this.config.cacheMaxAgeMs) {
                    localStorage.removeItem(CACHE_KEYS.CACHED_DATA);
                    localStorage.removeItem(CACHE_KEYS.CACHED_AT);
                    return null;
                }
                return { data: JSON.parse(raw), cachedAt };
            } catch {
                return null;
            }
        },

        /** 캐시에 데이터 저장 */
        saveToCache(data) {
            try {
                if (!data) return false;
                localStorage.setItem(CACHE_KEYS.CACHED_DATA, JSON.stringify(data));
                localStorage.setItem(CACHE_KEYS.CACHED_AT, String(Date.now()));
                return true;
            } catch {
                return false;
            }
        },

        /** Health Check - 로컬 서버 연결 가능 여부 */
        async checkHealth() {
            try {
                const res = await fetch(this.config.apiBase + '/health', { method: 'GET' });
                return res.ok;
            } catch {
                return false;
            }
        },

        /** API에서 전체 사양 데이터 fetch */
        async fetchSpecData() {
            try {
                const res = await fetch(this.config.apiBase + '/');
                if (!res.ok) return null;
                return await res.json();
            } catch {
                return null;
            }
        },

        /** 사양 비교 테이블 업데이트 */
        updateSpecTable(data) {
            const ids = this.config.specIds;
            const os = data?.os;
            const cpu = data?.cpu;
            const mem = data?.memory;
            const gpu = data?.gpu;
            const disk = data?.disk;

            const setSpec = (id, text, ok) => {
                const el = document.getElementById(id);
                if (!el) return;
                el.textContent = text || 'N/A';
                el.className = ok === true ? 'spec-ok' : (ok === false ? 'spec-fail' : '');
            };

            setSpec(ids.os, os?.name ? `${os.name} (${os.architecture || ''})` : null, null);
            setSpec(ids.cpu, cpu?.name || null, null);
            setSpec(ids.ram, mem ? `${mem.total_gb || 0} GB` : null, null);
            const gpuName = gpu?.graphics_cards?.[0]?.name;
            const gpuVram = gpu?.graphics_cards?.[0]?.adapter_ram_mb;
            setSpec(ids.gpu, gpuName ? `${gpuName}${gpuVram ? ` (${(gpuVram / 1024).toFixed(1)} GB)` : ''}` : null, null);
            const totalDisk = disk?.logical_drives?.reduce((s, d) => s + (d.total_gb || 0), 0) || 0;
            setSpec(ids.disk, totalDisk ? `${Math.round(totalDisk)} GB` : null, null);
        },

        _tick(startTime) {
            if (this._countdownInterval) clearInterval(this._countdownInterval);
            this._countdownInterval = setInterval(() => {
                const remainingMs = Math.max(0, this.config.maxWaitMs - (Date.now() - startTime));
                if (typeof window.StovScanner_updateCountdown === 'function') {
                    window.StovScanner_updateCountdown(remainingMs);
                }
            }, 16);
        },

        _stopTick() {
            if (this._countdownInterval) {
                clearInterval(this._countdownInterval);
                this._countdownInterval = null;
            }
        },

        /**
         * 데이터를 HTML에 전달. HTML에서 정의한 StovScanner_renderContent 콜백으로 렌더링 위임.
         */
        _notifyDataReady(data) {
            if (typeof window.StovScanner_renderContent === 'function') {
                window.StovScanner_renderContent(data);
            }
        },

        /**
         * 내 사양 조사하기 - 메인 진입점
         * 캐시 조회 → 캐시 있으면 표시 후 백그라운드 갱신
         * 캐시 없으면 프로토콜 실행 → 폴링 → 성공 시 표시, 실패 시 설치 팝업
         */
        async startSpecSurvey() {
            const cached = this.getCachedData();
            if (cached) {
                this.updateSpecTable(cached.data);
                this._notifyDataReady(cached.data);
                if (await this.checkHealth()) {
                    const data = await this.fetchSpecData();
                    if (data) {
                        this.saveToCache(data);
                        this.updateSpecTable(data);
                        this._notifyDataReady(data);
                    }
                }
                return;
            }

            this._showPopup();
            // 팝업이 화면에 그려진 후 프로토콜 실행 (즉시 실행 시 브라우저가 팝업을 그리기 전에 다른 동작 수행)
            await new Promise(r => requestAnimationFrame(() => setTimeout(r, 150)));
            window.location.href = 'stovescanner://start';

            const startTime = Date.now();
            this._tick(startTime);

            while (Date.now() - startTime < this.config.maxWaitMs) {
                if (await this.checkHealth()) {
                    this._stopTick();
                    const elapsed = Date.now() - startTime;
                    const minDisplay = this.config.minPopupDisplayMs || 0;
                    if (minDisplay > 0 && elapsed < minDisplay) {
                        await new Promise(r => setTimeout(r, minDisplay - elapsed));
                    }
                    this._hidePopup();
                    const data = await this.fetchSpecData();
                    if (data) {
                        this.saveToCache(data);
                        this.updateSpecTable(data);
                        this._notifyDataReady(data);
                    }
                    return;
                }
                await new Promise(r => setTimeout(r, this.config.pollIntervalMs));
            }

            this._stopTick();
            this._setPopupInstallState();
        },
    };

    global.StovScanner_API = StovScanner_API;
})(typeof window !== 'undefined' ? window : this);
