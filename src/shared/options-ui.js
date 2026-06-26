export function createOptionsUi(dependencies) {
  const {
    document, optionsPopupId: OPTIONS_POPUP_ID, refreshOptionsPopupState,
    getVolumeSliderMode, setVolumeSliderMode, getReplaceNativePlacement, setReplaceNativePlacement,
    isSnapTo5Enabled, setSnapTo5Enabled, isAlwaysExpandedEnabled, setAlwaysExpandedEnabled,
    isSliderOnVideo, setSliderLocation, getSavedOverlayOpacityPercent,
    setSavedOverlayOpacityPercent, resetSavedOverlayOpacityPercent,
    getSavedOverlaySizePercent, setSavedOverlaySizePercent, resetSavedOverlaySizePercent,
    getSavedSliderThicknessPercent, setSavedSliderThicknessPercent, resetSavedSliderThicknessPercent,
    beginThicknessSliderPreview, endThicknessSliderPreview,
    beginOpacitySliderPreview, endOpacitySliderPreview
  } = dependencies;

    function getEnabledRadios(group) {
        return Array.from(group.querySelectorAll('[role="radio"]:not(:disabled)'));
    }

    function syncOptionsRadioGroups(popup) {
        popup?.querySelectorAll('[role="radiogroup"]').forEach((group) => {
            const radios = getEnabledRadios(group);
            const checked = radios.find((radio) => radio.getAttribute('aria-checked') === 'true');
            const tabStop = checked || radios[0];
            group.querySelectorAll('[role="radio"]').forEach((radio) => {
                radio.tabIndex = radio === tabStop ? 0 : -1;
            });
        });
    }

    function handleRadioNavigation(event) {
        const radio = event.currentTarget;
        const group = radio.closest('[role="radiogroup"]');
        if (!group) return;
        const radios = getEnabledRadios(group);
        const currentIndex = radios.indexOf(radio);
        if (currentIndex < 0) return;

        let nextIndex;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
            nextIndex = (currentIndex - 1 + radios.length) % radios.length;
        } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
            nextIndex = (currentIndex + 1) % radios.length;
        } else if (event.key === 'Home') {
            nextIndex = 0;
        } else if (event.key === 'End') {
            nextIndex = radios.length - 1;
        } else {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        const next = radios[nextIndex];
        next.click();
        next.focus();
    }

    function createOptionsCheckboxRow(id, label, isChecked, onToggle) {
        const row = document.createElement('button');
        row.type = 'button';
        row.id = id;
        row.className = 'tm-volume-options-row';
        row.setAttribute('role', 'checkbox');
        row.setAttribute('aria-checked', isChecked ? 'true' : 'false');

        const text = document.createElement('span');
        text.textContent = label;

        const box = document.createElement('span');
        box.className = 'tm-volume-options-checkbox';
        box.setAttribute('aria-hidden', 'true');

        row.appendChild(text);
        row.appendChild(box);

        row.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const next = row.getAttribute('aria-checked') !== 'true';
            row.setAttribute('aria-checked', next ? 'true' : 'false');
            onToggle(next);
            refreshOptionsPopupState();
        });
        return row;
    }

    function createOptionsRadio(id, label, isChecked, onSelect) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = id;
        btn.className = 'tm-volume-options-radio';
        btn.setAttribute('role', 'radio');
        btn.setAttribute('aria-checked', isChecked ? 'true' : 'false');
        btn.tabIndex = isChecked ? 0 : -1;
        btn.textContent = label;
        btn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            onSelect();
            refreshOptionsPopupState();
            syncOptionsRadioGroups(document.getElementById(OPTIONS_POPUP_ID));
        });
        btn.addEventListener('keydown', handleRadioNavigation);
        return btn;
    }

    function createOptionsSectionLabel(text) {
        const label = document.createElement('div');
        label.className = 'tm-volume-options-section-label';
        label.textContent = text;
        return label;
    }

    function createOptionsSegment(radios) {
        const segment = document.createElement('div');
        segment.className = 'tm-volume-options-segment';
        radios.forEach((radio) => segment.appendChild(radio));
        return segment;
    }

    function createModeSection() {
        const section = document.createElement('div');
        section.className = 'tm-volume-options-section';
        section.appendChild(createOptionsSectionLabel('Mode'));

        const stack = document.createElement('div');
        stack.className = 'tm-volume-options-segment-stack';
        stack.setAttribute('role', 'radiogroup');
        stack.setAttribute('aria-label', 'Mode');

        stack.appendChild(createOptionsSegment([
            createOptionsRadio(
                'tm-volume-options-mode-on',
                'On',
                getVolumeSliderMode() === 'on',
                () => setVolumeSliderMode('on')
            ),
            createOptionsRadio(
                'tm-volume-options-mode-off',
                'Off',
                getVolumeSliderMode() === 'off',
                () => setVolumeSliderMode('off')
            )
        ]));

        stack.appendChild(createOptionsSegment([
            createOptionsRadio(
                'tm-volume-options-mode-replace-native',
                'Replace native',
                getVolumeSliderMode() === 'replace-native',
                () => setVolumeSliderMode('replace-native')
            )
        ]));

        section.appendChild(stack);
        return section;
    }

    function createPlacementSection() {
        const section = document.createElement('div');
        section.className = 'tm-volume-options-section';
        section.id = 'tm-volume-options-placement-section';
        section.appendChild(createOptionsSectionLabel('Position when replacing native'));

        const segment = createOptionsSegment([
            createOptionsRadio(
                'tm-volume-options-placement-native',
                'Native spot',
                getReplaceNativePlacement() === 'native',
                () => setReplaceNativePlacement('native')
            ),
            createOptionsRadio(
                'tm-volume-options-placement-custom',
                'Custom spot',
                getReplaceNativePlacement() === 'custom',
                () => setReplaceNativePlacement('custom')
            )
        ]);
        segment.setAttribute('role', 'radiogroup');
        segment.setAttribute('aria-label', 'Position when replacing native');
        section.appendChild(segment);
        return section;
    }

    function createBehaviorSection() {
        const section = document.createElement('div');
        section.className = 'tm-volume-options-section';
        section.appendChild(createOptionsSectionLabel('Slider behavior'));

        const list = document.createElement('div');
        list.className = 'tm-volume-options-checklist';
        list.appendChild(createOptionsCheckboxRow(
            'tm-volume-options-snap',
            'Snap to 5%',
            isSnapTo5Enabled(),
            (next) => setSnapTo5Enabled(next)
        ));
        list.appendChild(createOptionsCheckboxRow(
            'tm-volume-options-always-expanded',
            'Always expanded',
            isAlwaysExpandedEnabled(),
            (next) => setAlwaysExpandedEnabled(next)
        ));
        list.appendChild(createOptionsCheckboxRow(
            'tm-volume-options-location-video',
            'Show on video',
            isSliderOnVideo(),
            (next) => setSliderLocation(next ? 'video' : 'controls')
        ));
        section.appendChild(list);
        return section;
    }

    function createRangeSettingRow({
        label,
        ariaLabel,
        resetAriaLabel,
        min,
        max,
        step,
        fallback,
        getValue,
        setValue,
        resetValue,
        onPreviewStart,
        onPreviewEnd,
        getFillPercent = (value) => value
    }) {
        const row = document.createElement('div');
        row.className = 'tm-volume-options-opacity-row';

        const labelGroup = document.createElement('div');
        labelGroup.className = 'tm-volume-options-opacity-label-group';

        const name = document.createElement('span');
        name.className = 'tm-volume-options-opacity-name';
        name.textContent = label;

        const valueEl = document.createElement('span');
        valueEl.className = 'tm-volume-options-opacity-value';

        const resetBtn = document.createElement('button');
        resetBtn.type = 'button';
        resetBtn.className = 'tm-volume-options-opacity-reset';
        resetBtn.textContent = 'Reset';
        resetBtn.setAttribute('aria-label', resetAriaLabel);

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = String(min);
        slider.max = String(max);
        slider.step = String(step);
        slider.className = 'tm-volume-options-opacity-slider';
        slider.setAttribute('aria-label', ariaLabel);

        const refresh = () => {
            const pct = getValue();
            slider.value = String(pct);
            slider.style.setProperty('--tm-opacity-fill', `${getFillPercent(pct)}%`);
            valueEl.textContent = `${Math.round(pct)}%`;
        };
        refresh();

        ['click', 'mousedown', 'pointerdown', 'keydown'].forEach((type) => {
            slider.addEventListener(type, (event) => event.stopPropagation());
        });
        let previewActive = false;
        const startPreview = (event) => {
            if (event?.type === 'mousedown' && event.button !== 0) return;
            if (previewActive) return;
            previewActive = true;
            onPreviewStart?.();
        };
        const endPreview = () => {
            if (!previewActive) return;
            previewActive = false;
            onPreviewEnd?.();
        };
        ['pointerdown', 'mousedown', 'touchstart'].forEach((type) => {
            slider.addEventListener(type, startPreview);
        });
        [document, document.defaultView].filter(Boolean).forEach((target) => {
            ['pointerup', 'pointercancel', 'mouseup', 'touchend', 'touchcancel', 'blur']
                .forEach((type) => target.addEventListener(type, endPreview, true));
        });
        slider.addEventListener('blur', endPreview);
        slider.addEventListener('input', () => {
            const value = Number(slider.value);
            const pct = Number.isFinite(value) ? value : fallback;
            slider.style.setProperty('--tm-opacity-fill', `${getFillPercent(pct)}%`);
            valueEl.textContent = `${Math.round(pct)}%`;
            setValue(pct);
        });
        resetBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            resetValue();
            refresh();
        });

        labelGroup.appendChild(name);
        labelGroup.appendChild(valueEl);

        const controls = document.createElement('div');
        controls.className = 'tm-volume-options-opacity-controls';
        controls.appendChild(slider);
        controls.appendChild(resetBtn);

        row.appendChild(labelGroup);
        row.appendChild(controls);
        return row;
    }

    function createOpacityRow(label, focused) {
        return createRangeSettingRow({
            label,
            ariaLabel: `${label} opacity`,
            resetAriaLabel: `Reset ${label} opacity`,
            min: 0,
            max: 100,
            step: 1,
            fallback: 0,
            getValue: () => getSavedOverlayOpacityPercent(focused),
            setValue: (pct) => setSavedOverlayOpacityPercent(focused, pct),
            resetValue: () => resetSavedOverlayOpacityPercent(focused),
            onPreviewStart: () => beginOpacitySliderPreview?.(focused),
            onPreviewEnd: endOpacitySliderPreview
        });
    }

    function createOpacitySection() {
        const section = document.createElement('div');
        section.className = 'tm-volume-options-section';
        section.id = 'tm-volume-options-opacity-section';
        section.appendChild(createOptionsSectionLabel('On-video opacity'));
        section.appendChild(createOpacityRow('Idle', false));
        section.appendChild(createOpacityRow('Active', true));
        return section;
    }

    function createSizeSection() {
        const section = document.createElement('div');
        section.className = 'tm-volume-options-section';
        section.id = 'tm-volume-options-size-section';
        section.appendChild(createOptionsSectionLabel('On-video size'));

        section.appendChild(createRangeSettingRow({
            label: 'Size',
            ariaLabel: 'On-video size',
            resetAriaLabel: 'Reset on-video size',
            min: 100,
            max: 200,
            step: 5,
            fallback: 100,
            getValue: getSavedOverlaySizePercent,
            setValue: setSavedOverlaySizePercent,
            resetValue: resetSavedOverlaySizePercent,
            getFillPercent: (pct) => pct - 100
        }));
        return section;
    }

    function createThicknessSection() {
        const section = document.createElement('div');
        section.className = 'tm-volume-options-section';
        section.id = 'tm-volume-options-thickness-section';
        section.appendChild(createOptionsSectionLabel('Bar thickness'));

        section.appendChild(createRangeSettingRow({
            label: 'Thickness',
            ariaLabel: 'Bar thickness',
            resetAriaLabel: 'Reset bar thickness',
            min: 25,
            max: 125,
            step: 5,
            fallback: 75,
            getValue: getSavedSliderThicknessPercent,
            setValue: setSavedSliderThicknessPercent,
            resetValue: resetSavedSliderThicknessPercent,
            onPreviewStart: beginThicknessSliderPreview,
            onPreviewEnd: endThicknessSliderPreview,
            getFillPercent: (pct) => pct - 25
        }));
        return section;
    }

    function buildOptionsPopup() {
        const popup = document.createElement('div');
        popup.id = OPTIONS_POPUP_ID;
        popup.setAttribute('role', 'dialog');
        popup.setAttribute('aria-label', 'Volume Slider Options');
        popup.toggleAttribute('hidden', true);

        const header = document.createElement('div');
        header.className = 'tm-volume-options-header';
        const title = document.createElement('div');
        title.className = 'tm-volume-options-title';
        title.textContent = 'Volume Slider Options';
        header.appendChild(title);

        const body = document.createElement('div');
        body.className = 'tm-volume-options-body';
        body.appendChild(createModeSection());
        body.appendChild(createPlacementSection());
        body.appendChild(createBehaviorSection());
        body.appendChild(createThicknessSection());
        body.appendChild(createOpacitySection());
        body.appendChild(createSizeSection());

        popup.appendChild(header);
        popup.appendChild(body);
        popup.addEventListener('click', (event) => event.stopPropagation());
        return popup;
    }

  return { buildOptionsPopup, syncOptionsRadioGroups };
}
