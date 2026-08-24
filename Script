// ==UserScript==
// @name SNOL Helper 2.21 Evaluation Extra
// @namespace none
// @version 2.21
// @description
// @include      *org/index.php/observation/c_followup_disease/getReportOPD*
// @exclude      *org/*preview*
// @exclude      *org/*print*
// @exclude      *org/index.php/observation/c_surgical_medicine/print_surgical_medicine*
// @grant none
// ==/UserScript==

(function() {
    'use strict';

    // --- Persistence Constants ---
    const DOCTOR_STORAGE_KEY = 'snol_helper_last_doctor';
    const ONE_HOUR_MS = 60 * 60 * 1000; // 1 hour in milliseconds

    /**
     * Retrieves the last saved doctor selection if it hasn't expired.
     * @returns {string | null} The doctor value or null if expired or not found.
     */
    function getStoredDoctor() {
        try {
            const storedData = localStorage.getItem(DOCTOR_STORAGE_KEY);
            if (!storedData) return null;

            const data = JSON.parse(storedData);
            const now = new Date().getTime();

            // Check if the stored data is less than 1 hour old
            if (now - data.timestamp < ONE_HOUR_MS) {
                return data.value;
            } else {
                // Data expired, clear it
                localStorage.removeItem(DOCTOR_STORAGE_KEY);
                return null;
            }
        } catch (e) {
            console.error('SNOL Helper: Failed to retrieve or parse stored doctor data:', e);
            localStorage.removeItem(DOCTOR_STORAGE_KEY);
            return null;
        }
    }

    /**
     * Stores the currently selected doctor value with a timestamp.
     * @param {string} doctorValue The selected doctor's value.
     */
    function storeDoctor(doctorValue) {
        if (!doctorValue) return;

        try {
            const dataToStore = {
                value: doctorValue,
                timestamp: new Date().getTime()
            };
            localStorage.setItem(DOCTOR_STORAGE_KEY, JSON.stringify(dataToStore));
        } catch (e) {
            console.error('SNOL Helper: Failed to store doctor data:', e);
        }
    }

    /**
     * Waits until a selector reaches at least `minCount` matching elements,
     * polling on animation frames instead of guessing with a fixed delay.
     * This is what fixes the mobile timing gap: mobile browsers can take
     * noticeably longer to re-render after a row is dynamically added,
     * so a hardcoded 50-300ms delay that works on desktop can run out
     * before the row (and its rich-text editor) actually exists.
     * @param {string} selector Class name to look up via getElementsByClassName-style match (no dot).
     * @param {number} minCount Minimum number of matching elements required.
     * @param {number} timeout Max time to wait in ms before rejecting.
     * @returns {Promise<HTMLCollectionOf<Element>>}
     */
    function waitForElementCount(selector, minCount, timeout = 4000) {
        return new Promise((resolve, reject) => {
            const start = Date.now();
            (function check() {
                const els = document.getElementsByClassName(selector);
                if (els.length >= minCount) {
                    resolve(els);
                    return;
                }
                if (Date.now() - start > timeout) {
                    reject(new Error(`Timeout waiting for "${selector}" to reach ${minCount} elements (found ${els.length})`));
                    return;
                }
                requestAnimationFrame(check);
            })();
        });
    }

    /**
     * Waits until the .note-editable.card-block collection has at least
     * `minCount` elements. Used specifically before applyTemplate() runs,
     * since that's the collection whose length determines whether index 46
     * (and similar late indices) actually exist yet.
     */
    function waitForNoteEditableCount(minCount, timeout = 4000) {
        return new Promise((resolve, reject) => {
            const start = Date.now();
            (function check() {
                const els = document.querySelectorAll('.note-editable.card-block');
                if (els.length >= minCount) {
                    resolve(els);
                    return;
                }
                if (Date.now() - start > timeout) {
                    reject(new Error(`Timeout waiting for .note-editable.card-block to reach ${minCount} elements (found ${els.length})`));
                    return;
                }
                requestAnimationFrame(check);
            })();
        });
    }

    // Get stored value to use as initial selection
    const initialDoctorValue = getStoredDoctor() || '';

    // Create floating container
    const container = document.createElement('div');
    Object.assign(container.style, {
        position: 'fixed',
        top: '400px', // CHANGED: Anchor to the top
        right: '20px',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        visibility: 'visible',
        opacity: '1',
        transition: 'visibility 0s, opacity 0.3s linear'
    });

    // Create show/hide button
    const toggleButton = document.createElement('button');
    toggleButton.textContent = 'Hide Helper';
    Object.assign(toggleButton.style, {
        padding: '8px 6px', // Reduced horizontal padding by 25% (8px * 0.75 = 6px)
        backgroundColor: '#6c757d', // Grey color
        color: 'white',
        border: 'none',
        borderRadius: '5px',
        fontSize: '12px',
        cursor: 'pointer',
        alignSelf: 'flex-end',
        marginBottom: '5px'
    });

    // Create a wrapper for the dropdowns and Run Script button
    const controlsWrapper = document.createElement('div');
    Object.assign(controlsWrapper.style, {
        display: 'flex',
        flexDirection: 'column',
        gap: '10px'
    });

    // Helper function to create dropdowns
    function createDropdown(options, initialText, defaultValue = '') {
        const dropdown = document.createElement('select');
        Object.assign(dropdown.style, {
            padding: '8px 6px', // Reduced horizontal padding by 25%
            backgroundColor: '#f8f9fa',
            border: '1px solid #ccc',
            borderRadius: '5px',
            fontSize: '14px',
            minWidth: '150px' // Reduced minWidth by 25% (200px * 0.75 = 150px)
        });

        const initialOption = document.createElement('option');
        initialOption.value = ''; // Ensure empty value for initial selection
        initialOption.textContent = initialText;
        dropdown.appendChild(initialOption);

        options.forEach(opt => {
            const option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.text;
            if (opt.disabled) {
                option.disabled = true;
                option.style.fontWeight = 'bold';
                option.style.backgroundColor = '#e9ecef';
            }
            dropdown.appendChild(option);
        });

        // Set default value if provided
        if (defaultValue) {
            dropdown.value = defaultValue;
        }
        return dropdown;
    }

    // Combined procedure dropdown options - simplified values
    const procedureOptions = [
        { value: 're_phaco', text: 'RE Phaco + IOL' },
        { value: 'le_phaco', text: 'LE Phaco + IOL' },
        { value: 're_pterygium', text: 'RE Pterygium Excision' },
        { value: 'le_pterygium', text: 'LE Pterygium Excision' }
    ];
    const combinedProcedureDropdown = createDropdown(procedureOptions, '-- Select Procedure --');

    // Doctor dropdown options
    const doctorOptions = [
        { value: 'Prof. Kong Piseth', text: 'Prof. Kong Piseth' },
        { value: 'Prof. Sun Sarin', text: 'Prof. Sun Sarin' },
        { value: 'Prof. Pok Thorn', text: 'Prof. Pok Thorn' },
        { value: 'Prof. Mar Amarin', text: 'Prof. Mar Amarin' },
        { value: 'Dr. Chukmol Kossama', text: 'Chukmol Kossama' },
        { value: 'Dr. Chamroeun Sokhavan', text: 'Chamroeun Sokhavan' },
        { value: 'Dr. Chea Guechlaing', text: 'Chea Guechlaing' },
        { value: 'Dr. Chhun Vyseth', text: 'Chhun Vyseth' },
        { value: 'Dr. Chork Sreyla', text: 'Chork Sreyla' },
        { value: 'Dr. Hang Sophorn', text: 'Hang Sophorn' },
        { value: 'Dr. Heng Channkosal', text: 'Heng Channkosal' },
        { value: 'Dr. Heng Hour', text: 'Heng Hour' },
        { value: 'Dr. Hin Dan', text: 'Hin Dan' },
        { value: 'Dr. Hing Sokunthy', text: 'Hing Sokunthy' },
        { value: 'Dr. Hong Sengdavy', text: 'Hong Sengdavy' },
        { value: 'Dr. Hun Tithsya', text: 'Hun Tithsya' },
        { value: 'Dr. Huor Chansy', text: 'Huor Chansy' },
        { value: 'Dr. Kak Sokunsowattra', text: 'Kak Sokunsowattra' },
        { value: 'Dr. Khoy Sothearith', text: 'Khoy Sothearith' },
        { value: 'Dr. Kim Chenda', text: 'Kim Chenda' },
        { value: 'Dr. Kith Channdarith', text: 'Kith Channdarith' },
        { value: 'Dr. Krin Sreypeou', text: 'Krin Sreypeou' },
        { value: 'Dr. Lay Kimhour', text: 'Lay Kimhour' },
        { value: 'Dr. Leang Sereyvath', text: 'Leang Sereyvath' },
        { value: 'Dr. Leang SrosRomdoul', text: 'Leang SrosRomdoul' },
        { value: 'Dr. Leng Channath', text: 'Leng Channath' },
        { value: 'Dr. Leng Cheangkheang', text: 'Leng Cheangkheang' },
        { value: 'Dr. Lim Tyngang', text: 'Lim Tyngang' },
        { value: 'Dr. Long Kensreymean', text: 'Long Kensreymean' },
        { value: 'Dr. Luy Rinseyhakyutt', text: 'Luy Rinseyhakyutt' },
        { value: 'Dr. Ly Marina', text: 'Ly Marina' },
        { value: 'Dr. Morm Pheakdey', text: 'Morm Pheakdey' },
        { value: 'Dr. Ny Chandaravibol', text: 'Ny Chandaravibol' },
        { value: 'Dr. Ny Povpronet', text: 'Ny Povpronet' },
        { value: 'Dr. Or Leakhena', text: 'Or Leakhena' },
        { value: 'Dr. Ou VongVirak', text: 'Ou VongVirak' },
        { value: 'Dr. Ouk Sokhean', text: 'Ouk Sokhean' },
        { value: 'Dr. Poch Boramey', text: 'Poch Boramey' },
        { value: 'Dr. Prak Kimsreng', text: 'Prak Kimsreng' },
        { value: 'Dr. Reth Chongchiv', text: 'Reth Chongchiv' },
        { value: 'Dr. Rith Narong', text: 'Rith Narong' },
        { value: 'Dr. Samreth Serey Oudam', text: 'Samreth Serey Oudam' },
        { value: 'Dr. Sea Bunseng', text: 'Sea Bunseng' },
        { value: 'Dr. Soeung Soryoun', text: 'Soeung Soryoun' },
        { value: 'Dr. Sok Chenda', text: 'Sok Chenda' },
        { value: 'Dr. Sok Virabot', text: 'Sok Virabot' },
        { value: 'Dr. Sorn Bottomalen', text: 'Sorn Bottomalen' },
        { value: 'Dr. Soung Mengsreang', text: 'Soung Mengsreang' },
        { value: 'Dr. Srun Bunrong', text: 'Srun Bunrong' },
        { value: 'Dr. Sun Vinh', text: 'Sun Vinh' },
        { value: 'Dr. Teng Vannaroit', text: 'Teng Vannaroit' },
        { value: 'Dr. Tor Krytha', text: 'Tor Krytha' },
        { value: 'Dr. Tor Remy', text: 'Tor Remy' },
        { value: 'Dr. Try Mengsry', text: 'Try Mengsry' },
        { value: 'Dr. Un Leng', text: 'Un Leng' }
    ];
    // Use the retrieved or default value here
    const doctorDropdown = createDropdown(doctorOptions, '-- Select Doctor --', initialDoctorValue);

    // --- Add listener to persist doctor selection on change ---
    doctorDropdown.addEventListener('change', (event) => {
        storeDoctor(event.target.value);
    });

    // Anesthesia dropdown options
    const anesthesiaOptions = [
        { value: 'Local Anesthesia', text: 'Local Anesthesia' },
        { value: 'General Anesthesia', text: 'General Anesthesia' }
    ];
    // Set 'Local Anesthesia' as default
    const anesthesiaDropdown = createDropdown(anesthesiaOptions, '-- Select Anesthesia --', 'Local Anesthesia');

    // Create run button for SNOL
    const btnSNOL = document.createElement('button');
    btnSNOL.textContent = 'Run SNOL'; // Changed text here
    Object.assign(btnSNOL.style, {
        padding: '12px 9px', // Reduced horizontal padding by 25% (12px * 0.75 = 9px)
        backgroundColor: '#008CBA',
        color: 'white',
        border: 'none',
        borderRadius: '5px',
        fontSize: '14px',
        boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
        cursor: 'pointer'
    });

    // Create run button for New Procedures
    const btnNew = document.createElement('button');
    btnNew.textContent = 'Run Evaluation'; // Changed text here
    Object.assign(btnNew.style, {
        padding: '12px 9px', // Reduced horizontal padding by 25% (12px * 0.75 = 9px)
        backgroundColor: '#DAA520', // Gold color for distinction
        color: 'white',
        border: 'none',
        borderRadius: '5px',
        fontSize: '14px',
        boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
        cursor: 'pointer'
    });

    // Add elements to controlsWrapper
    controlsWrapper.appendChild(combinedProcedureDropdown);
    controlsWrapper.appendChild(doctorDropdown);
    controlsWrapper.appendChild(anesthesiaDropdown);
    controlsWrapper.appendChild(btnSNOL);
    controlsWrapper.appendChild(btnNew);

    // Add toggle button and controlsWrapper to container
    container.appendChild(toggleButton);
    container.appendChild(controlsWrapper);
    document.body.appendChild(container);

    // Define templates
    const templates = {
        re_phaco_snol: {
            textContents: [
                { index: 7, text: 'RE Blurred of Vision' },
                { index: 8, text: 'No medical history' },
                { index: 9, text: 'No social history' },
                { index: 10, text: 'No family history' },
                { index: 16, text: 'GCS 15/15' },
                { index: 17, text: 'No Pathological Sound' },
                { index: 18, text: 'CRT <2s' },
                { index: 19, text: 'Peristalsis (+)' },
                { index: 20, text: 'Urine Output 2L/d<br>Urine Color: Clear' },
                { index: 27, text: 'ANESTHESIA_PLACEHOLDER' },
                { index: 28, text: 'DOCTOR_PLACEHOLDER' },
                { index: 29, text: 'Mr Bo' },
                { index: 30, text: 'None' },
                { index: 31, text: 'VA 6/9.5, IOP 12<br>lid: mild swelling<br>conjunctiva: moderate injection + chemosis<br>wound: sealed<br>AC forms, no fibrin<br>IOL stable in bag' },
                { index: 32, text: 'Better' },
                { index: 34, text: 'RE Pseudophakia' },
                { index: 36, text: '1 Week' },
            ],
            inputs: [
                { selector: '.cornea_re.form-control.khmer', value: 'Clear' },
                { selector: '.cornea_le.form-control.khmer', value: 'Clear' },
                { selector: '.ac_re.form-control.khmer', value: 'Deep and Quiet' },
                { selector: '.ac_le.form-control.khmer', value: 'Deep and Quiet' },
                { selector: '.pupil_re.form-control.khmer', value: 'Round and React to Light' },
                { selector: '.pupil_le.form-control.khmer', value: 'Round and React to Light' },
                { selector: '.angle_re.form-control.khmer', value: 'Open' },
                { selector: '.angle_le.form-control.khmer', value: 'Open' },
                { selector: '.iris_re.form-control.khmer', value: 'Flat' },
                { selector: '.iris_le.form-control.khmer', value: 'Flat' },
                { selector: '.len_re.form-control.khmer', value: 'Opacity' },
                { selector: '.len_le.form-control.khmer', value: 'Clear' },
                { selector: '.iop_re_pressure.form-control.khmer', value: '12' },
                { selector: '.iop_le_pressure.form-control.khmer', value: '12' },
                { selector: '.eyelid_re.form-control.khmer', value: 'No swelling' },
                { selector: '.eyelid_le.form-control.khmer', value: 'No swelling' },
                { selector: '.conjunctiva_re.form-control.khmer', value: 'No injection' },
                { selector: '.conjunctiva_le.form-control.khmer', value: 'No injection' },
                { selector: '.nld_re.form-control.khmer', value: 'Permeable' },
                { selector: '.nld_le.form-control.khmer', value: 'Permeable' },
                { selector: '.eom_re.form-control.khmer', value: 'Full' },
                { selector: '.eom_le.form-control.khmer', value: 'Full' }
            ],
            preClickInfo: { selector: "hidden-xs khmer", index: 1 }
        },
        le_phaco_snol: {
            textContents: [
                { index: 7, text: 'LE Blurred of Vision' },
                { index: 8, text: 'No medical history' },
                { index: 9, text: 'No social history' },
                { index: 10, text: 'No family history' },
                { index: 16, text: 'GCS 15/15' },
                { index: 17, text: 'No Pathological Sound' },
                { index: 18, text: 'CRT <2s' },
                { index: 19, text: 'Peristalsis (+)' },
                { index: 20, text: 'Urine Output 2L/d<br>Urine Color: Clear' },
                { index: 27, text: 'ANESTHESIA_PLACEHOLDER' },
                { index: 28, text: 'DOCTOR_PLACEHOLDER' },
                { index: 29, text: 'Mr Bo' },
                { index: 30, text: 'None' },
                { index: 31, text: 'VA 6/9.5, IOP 12<br>lid: mild swelling<br>conjunctiva: moderate injection + chemosis<br>wound: sealed<br>AC forms, no fibrin<br>IOL stable in bag' },
                { index: 32, text: 'Better' },
                { index: 34, text: 'LE Pseudophakia' },
                { index: 36, text: '1 Week' },
            ],
            inputs: [
                { selector: '.cornea_re.form-control.khmer', value: 'Clear' },
                { selector: '.cornea_le.form-control.khmer', value: 'Clear' },
                { selector: '.ac_re.form-control.khmer', value: 'Deep and Quiet' },
                { selector: '.ac_le.form-control.khmer', value: 'Deep and Quiet' },
                { selector: '.pupil_re.form-control.khmer', value: 'Round and React to Light' },
                { selector: '.pupil_le.form-control.khmer', value: 'Round and React to Light' },
                { selector: '.angle_re.form-control.khmer', value: 'Open' },
                { selector: '.angle_le.form-control.khmer', value: 'Open' },
                { selector: '.iris_re.form-control.khmer', value: 'Flat' },
                { selector: '.iris_le.form-control.khmer', value: 'Flat' },
                { selector: '.len_re.form-control.khmer', value: 'Clear' },
                { selector: '.len_le.form-control.khmer', value: 'Opacity' },
                { selector: '.iop_re_pressure.form-control.khmer', value: '12' },
                { selector: '.iop_le_pressure.form-control.khmer', value: '12' },
                { selector: '.eyelid_re.form-control.khmer', value: 'No swelling' },
                { selector: '.eyelid_le.form-control.khmer', value: 'No swelling' },
                { selector: '.conjunctiva_re.form-control.khmer', value: 'No injection' },
                { selector: '.conjunctiva_le.form-control.khmer', value: 'No injection' },
                { selector: '.nld_re.form-control.khmer', value: 'Permeable' },
                { selector: '.nld_le.form-control.khmer', value: 'Permeable' },
                { selector: '.eom_re.form-control.khmer', value: 'Full' },
                { selector: '.eom_le.form-control.khmer', value: 'Full' }
            ],
            preClickInfo: { selector: "hidden-xs khmer", index: 1 }
        },
        re_pterygium_snol: {
            textContents: [
                { index: 7, text: 'RE Irritation and Tearing' },
                { index: 8, text: 'No medical history' },
                { index: 9, text: 'No social history' },
                { index: 10, text: 'No family history' },
                { index: 16, text: 'GCS 15/15' },
                { index: 17, text: 'No Pathological Sound' },
                { index: 18, text: 'CRT <2s' },
                { index: 19, text: 'Peristalsis (+)' },
                { index: 20, text: 'Urine Output 2L/d<br>Urine Color: Clear' },
                { index: 27, text: 'ANESTHESIA_PLACEHOLDER' },
                { index: 28, text: 'DOCTOR_PLACEHOLDER' },
                { index: 29, text: 'Mr Bo' },
                { index: 30, text: 'None' },
                { index: 31, text: 'VA 6/9.5, IOP 12<br>lid: mild swelling<br>conjunctiva: moderate injection<br>graft in place<br>suture no loose<br>cornea smooth<br>harvest site: clean' },
                { index: 32, text: 'Better' },
                { index: 34, text: 'RE Pterygium Excision' },
                { index: 36, text: '1 Week' },
            ],
            inputs: [
                { selector: '.cornea_re.form-control.khmer', value: 'Pterygium Grade 2' },
                { selector: '.cornea_le.form-control.khmer', value: 'Clear' },
                { selector: '.ac_re.form-control.khmer', value: 'Deep and Quiet' },
                { selector: '.ac_le.form-control.khmer', value: 'Deep and Quiet' },
                { selector: '.pupil_re.form-control.khmer', value: 'Round and React to Light' },
                { selector: '.pupil_le.form-control.khmer', value: 'Round and React to Light' },
                { selector: '.angle_re.form-control.khmer', value: 'Open' },
                { selector: '.angle_le.form-control.khmer', value: 'Open' },
                { selector: '.iris_re.form-control.khmer', value: 'Flat' },
                { selector: '.iris_le.form-control.khmer', value: 'Flat' },
                { selector: '.len_re.form-control.khmer', value: 'Clear' },
                { selector: '.len_le.form-control.khmer', value: 'Clear' },
                { selector: '.iop_re_pressure.form-control.khmer', value: '12' },
                { selector: '.iop_le_pressure.form-control.khmer', value: '12' },
                { selector: '.eyelid_re.form-control.khmer', value: 'No swelling' },
                { selector: '.eyelid_le.form-control.khmer', value: 'No swelling' },
                { selector: '.conjunctiva_re.form-control.khmer', value: 'No injection' },
                { selector: '.conjunctiva_le.form-control.khmer', value: 'No injection' },
                { selector: '.nld_re.form-control.khmer', value: 'Permeable' },
                { selector: '.nld_le.form-control.khmer', value: 'Permeable' },
                { selector: '.eom_re.form-control.khmer', value: 'Full' },
                { selector: '.eom_le.form-control.khmer', value: 'Full' }
            ],
            preClickInfo: { selector: "hidden-xs khmer", index: 1 }
        },
        le_pterygium_snol: {
            textContents: [
                { index: 7, text: 'LE Irritation and Tearing' },
                { index: 8, text: 'No medical history' },
                { index: 9, text: 'No social history' },
                { index: 10, text: 'No family history' },
                { index: 16, text: 'GCS 15/15' },
                { index: 17, text: 'No Pathological Sound' },
                { index: 18, text: 'CRT <2s' },
                { index: 19, text: 'Peristalsis (+)' },
                { index: 20, text: 'Urine Output 2L/d<br>Urine Color: Clear' },
                { index: 27, text: 'ANESTHESIA_PLACEHOLDER' },
                { index: 28, text: 'DOCTOR_PLACEHOLDER' },
                { index: 29, text: 'Mr Bo' },
                { index: 30, text: 'None' },
                { index: 31, text: 'VA 6/9.5, IOP 12<br>lid: mild swelling<br>conjunctiva: moderate injection<br>graft in place<br>suture no loose<br>cornea smooth<br>harvest site: clean' },
                { index: 32, text: 'Better' },
                { index: 34, text: 'LE Pterygium Excision' },
                { index: 36, text: '1 Week' },
            ],
            inputs: [
                { selector: '.cornea_re.form-control.khmer', value: 'Clear' },
                { selector: '.cornea_le.form-control.khmer', value: 'Pterygium Grade 2' },
                { selector: '.ac_re.form-control.khmer', value: 'Deep and Quiet' },
                { selector: '.ac_le.form-control.khmer', value: 'Deep and Quiet' },
                { selector: '.pupil_re.form-control.khmer', value: 'Round and React to Light' },
                { selector: '.pupil_le.form-control.khmer', value: 'Round and React to Light' },
                { selector: '.angle_re.form-control.khmer', value: 'Open' },
                { selector: '.angle_le.form-control.khmer', value: 'Open' },
                { selector: '.iris_re.form-control.khmer', value: 'Flat' },
                { selector: '.iris_le.form-control.khmer', value: 'Flat' },
                { selector: '.len_re.form-control.khmer', value: 'Clear' },
                { selector: '.len_le.form-control.khmer', value: 'Clear' },
                { selector: '.iop_re_pressure.form-control.khmer', value: '12' },
                { selector: '.iop_le_pressure.form-control.khmer', value: '12' },
                { selector: '.eyelid_re.form-control.khmer', value: 'No swelling' },
                { selector: '.eyelid_le.form-control.khmer', value: 'No swelling' },
                { selector: '.conjunctiva_re.form-control.khmer', value: 'No injection' },
                { selector: '.conjunctiva_le.form-control.khmer', value: 'No injection' },
                { selector: '.nld_re.form-control.khmer', value: 'Permeable' },
                { selector: '.nld_le.form-control.khmer', value: 'Permeable' },
                { selector: '.eom_re.form-control.khmer', value: 'Full' },
                { selector: '.eom_le.form-control.khmer', value: 'Full' }
            ],
            preClickInfo: { selector: "hidden-xs khmer", index: 1 }
        },
        re_phaco_new: {
            textContents: [
                { index: 42, text: 'VA 6/60<br>IOP 12 mmHg<br>lid normal<br>conjunctiva quiet<br>cornea clear<br>anterior chamber deep and quiet<br>lens: opacity' },
                { index: 43, text: '- Paracetamol 500mg (គ្រាប់) 1-1-0-1 -ពិសា-1ថ្ងៃ' },
                { index: 44, text: 'test xylocaine 2% (-)' },
                { index: 45, text: '- Paracetamol 500mg (គ្រាប់) 1-1-0-1 -ពិសា-1ថ្ងៃ' },
                { index: 46, text: 'VA 6/9.5, IOP 12<br>lid: mild swelling<br>conjunctiva: moderate injection + chemosis<br>wound: sealed<br>AC forms, no fibrin<br>IOL stable in bag' },
                { index: 47, text: '- Aurofort Eye Drops (តំណក់) 0-0-0-0 -បន្តក់ភ្នែក-14ថ្ងៃ -២ ម៉ោងម្តង<br>- Aflacin Eye Drops (តំណក់) 0-0-0-0 -បន្តក់ភ្នែក-14ថ្ងៃ -២ ម៉ោងម្តង<br>- T-Mycin Plus Ointment (ដង) 0-0-0-1 -ច្របាច់-14ថ្ងៃ' },
            ],
            inputs: [],
            timeFields: [
                { title: 'Select Time', value: '08:00' },
                { title: 'Select End Time', value: '08:15' }
            ],
            classFields: [
                { selector: '.weight.form-control.number', value: '55' },
                { selector: '.height.form-control.number', value: '155' },
                { selector: '.t.form-control.number', value: '36.1' },
                { selector: '.p.form-control.number', value: '80' },
                { selector: '.fr.form-control.number', value: '19' },
                { selector: '.szo2.form-control', value: '99' },
                { selector: '.glucose.form-control.number', value: '90' }
            ],
            bpFields: [
                { selector: '.ta.form-control', systolicRange: [115, 125], diastolicRange: [75, 85] }
            ],
            preClickInfo: [
                { selector: "hidden-xs khmer", index: 12 },
                { selector: "tr_add_append_evolution", index: 0 },
                { selector: "tr_add_append_evolution", index: 0 }
            ]
        },
        le_phaco_new: {
            textContents: [
                { index: 42, text: 'VA 6/60<br>IOP 12 mmHg<br>lid normal<br>conjunctiva quiet<br>cornea clear<br>anterior chamber deep and quiet<br>lens: opacity' },
                { index: 43, text: '- Paracetamol 500mg (គ្រាប់) 1-1-0-1 -ពិសា-1ថ្ងៃ' },
                { index: 44, text: 'test xylocaine 2% (-)' },
                { index: 45, text: '- Paracetamol 500mg (គ្រាប់) 1-1-0-1 -ពិសា-1ថ្ងៃ' },
                { index: 46, text: 'VA 6/9.5, IOP 12<br>lid: mild swelling<br>conjunctiva: moderate injection + chemosis<br>wound: sealed<br>AC forms, no fibrin<br>IOL stable in bag' },
                { index: 47, text: '- Aurofort Eye Drops (តំណក់) 0-0-0-0 -បន្តក់ភ្នែក-14ថ្ងៃ -២ ម៉ោងម្តង<br>- Aflacin Eye Drops (តំណក់) 0-0-0-0 -បន្តក់ភ្នែក-14ថ្ងៃ -២ ម៉ោងម្តង<br>- T-Mycin Plus Ointment (ដង) 0-0-0-1 -ច្របាច់-14ថ្ងៃ' },
            ],
            inputs: [],
            timeFields: [
                { title: 'Select Time', value: '08:00' },
                { title: 'Select End Time', value: '08:15' }
            ],
            classFields: [
                { selector: '.weight.form-control.number', value: '55' },
                { selector: '.height.form-control.number', value: '155' },
                { selector: '.t.form-control.number', value: '36.1' },
                { selector: '.p.form-control.number', value: '80' },
                { selector: '.fr.form-control.number', value: '19' },
                { selector: '.szo2.form-control', value: '99' },
                { selector: '.glucose.form-control.number', value: '90' }
            ],
            bpFields: [
                { selector: '.ta.form-control', systolicRange: [115, 125], diastolicRange: [75, 85] }
            ],
            preClickInfo: [
                { selector: "hidden-xs khmer", index: 12 },
                { selector: "tr_add_append_evolution", index: 0 },
                { selector: "tr_add_append_evolution", index: 0 }
            ]
        },
        re_pterygium_new: {
            textContents: [
                { index: 42, text: 'VA 6/9.5<br>IOP 12 mmHg<br>lid normal<br>conjunctiva: nasal pterygium with moderate injection<br>cornea: pterygium extending onto the nasal cornea<br>anterior chamber deep and quiet<br>lens clear' },
                { index: 43, text: '- Paracetamol 500mg (គ្រាប់) 1-1-0-1 -ពិសា-1ថ្ងៃ' },
                { index: 44, text: 'test xylocaine 2% (-)' },
                { index: 45, text: '- Paracetamol 500mg (គ្រាប់) 1-1-0-1 -ពិសា-1ថ្ងៃ' },
                { index: 46, text: 'VA 6/9.5, IOP 12<br>lid: mild swelling<br>conjunctiva: moderate injection<br>graft in place<br>suture no loose<br>cornea smooth<br>harvest site: clean' },
                { index: 47, text: '- Dexoptic-N Eye Drops (តំណក់) 1-1-1-1 -បន្តក់ភ្នែក-14ថ្ងៃ<br>- T-Mycin Plus Ointment (ដង) 1-1-0-1 -ច្របាច់-14ថ្ងៃ' },
            ],
            inputs: [],
            timeFields: [
                { title: 'Select Time', value: '08:00' },
                { title: 'Select End Time', value: '08:15' }
            ],
            classFields: [
                { selector: '.weight.form-control.number', value: '55' },
                { selector: '.height.form-control.number', value: '155' },
                { selector: '.t.form-control.number', value: '36.1' },
                { selector: '.p.form-control.number', value: '80' },
                { selector: '.fr.form-control.number', value: '19' },
                { selector: '.szo2.form-control', value: '99' },
                { selector: '.glucose.form-control.number', value: '90' }
            ],
            bpFields: [
                { selector: '.ta.form-control', systolicRange: [115, 125], diastolicRange: [75, 85] }
            ],
            preClickInfo: [
                { selector: "hidden-xs khmer", index: 12 },
                { selector: "tr_add_append_evolution", index: 0 },
                { selector: "tr_add_append_evolution", index: 0 }
            ]
        },
        le_pterygium_new: {
            textContents: [
                { index: 42, text: 'VA 6/9.5<br>IOP 12 mmHg<br>lid normal<br>conjunctiva: nasal pterygium with moderate injection<br>cornea: pterygium extending onto the nasal cornea<br>anterior chamber deep and quiet<br>lens clear' },
                { index: 43, text: '- Paracetamol 500mg (គ្រាប់) 1-1-0-1 -ពិសា-1ថ្ងៃ' },
                { index: 44, text: 'test xylocaine 2% (-)' },
                { index: 45, text: '- Paracetamol 500mg (គ្រាប់) 1-1-0-1 -ពិសា-1ថ្ងៃ' },
                { index: 46, text: 'VA 6/9.5, IOP 12<br>lid: mild swelling<br>conjunctiva: moderate injection<br>graft in place<br>suture no loose<br>cornea smooth<br>harvest site: clean' },
                { index: 47, text: '- Dexoptic-N Eye Drops (តំណក់) 1-1-1-1 -បន្តក់ភ្នែក-14ថ្ងៃ<br>- T-Mycin Plus Ointment (ដង) 1-1-0-1 -ច្របាច់-14ថ្ងៃ' },
             ],
            inputs: [],
            timeFields: [
                { title: 'Select Time', value: '08:00' },
                { title: 'Select End Time', value: '08:15' }
            ],
            classFields: [
                { selector: '.weight.form-control.number', value: '55' },
                { selector: '.height.form-control.number', value: '155' },
                { selector: '.t.form-control.number', value: '36.1' },
                { selector: '.p.form-control.number', value: '80' },
                { selector: '.fr.form-control.number', value: '19' },
                { selector: '.szo2.form-control', value: '99' },
                { selector: '.glucose.form-control.number', value: '90' }
            ],
            bpFields: [
                { selector: '.ta.form-control', systolicRange: [115, 125], diastolicRange: [75, 85] }
            ],
            preClickInfo: [
                { selector: "hidden-xs khmer", index: 12 },
                { selector: "tr_add_append_evolution", index: 0 },
                { selector: "tr_add_append_evolution", index: 0 }
            ]
        }
    };

    // Function to apply selected template
    function applyTemplate(templateKey) {
        const template = templates[templateKey];
        if (!template) {
            displayMessage(`Template for "${templateKey}" not found!`, 'error');
            return;
        }

        let elements = document.querySelectorAll('.note-editable.card-block');

        template.textContents.forEach(({ index, text }) => {
            let element = elements[index];
            if (element) {
                let processedText = text;
                if (templateKey.endsWith('_snol')) {
                    processedText = text.replace('ANESTHESIA_PLACEHOLDER', anesthesiaDropdown.value)
                                        .replace('DOCTOR_PLACEHOLDER', doctorDropdown.value);
                }
                element.innerHTML = processedText;
                element.dispatchEvent(new Event('input', { bubbles: true }));
                element.dispatchEvent(new Event('change', { bubbles: true }));
            } else {
                console.warn(`SNOL Helper: element at index ${index} not found when applying "${templateKey}" (only ${elements.length} .note-editable.card-block elements present).`);
            }
        });

        template.inputs.forEach(({ selector, value }) => {
            let input = document.querySelector(selector);
            if (input) input.value = value;
        });

        if (template.timeFields) {
            template.timeFields.forEach(({ title, value }) => {
                const matches = document.querySelectorAll(`[title="${title}"]`);
                // Fill the 1st, 2nd, and 3rd elements sharing this title
                for (let i = 0; i < Math.min(3, matches.length); i++) {
                    const el = matches[i];
                    el.value = value;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                }
            });
        }

        if (template.classFields) {
            template.classFields.forEach(({ selector, value }) => {
                const matches = document.querySelectorAll(selector);
                // Fill the 1st, 2nd, and 3rd elements sharing this class
                for (let i = 0; i < Math.min(3, matches.length); i++) {
                    const el = matches[i];
                    el.value = value;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                }
            });
        }

        if (template.bpFields) {
            template.bpFields.forEach(({ selector, systolicRange, diastolicRange }) => {
                const matches = document.querySelectorAll(selector);
                // Fill the 1st, 2nd, and 3rd elements sharing this class
                for (let i = 0; i < Math.min(3, matches.length); i++) {
                    const el = matches[i];
                    // Random integer within [min, max], inclusive, independently per element
                    const randomizedSystolic = systolicRange[0] + Math.floor(Math.random() * (systolicRange[1] - systolicRange[0] + 1));
                    const randomizedDiastolic = diastolicRange[0] + Math.floor(Math.random() * (diastolicRange[1] - diastolicRange[0] + 1));
                    el.value = `${randomizedSystolic}/${randomizedDiastolic}`;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                }
            });
        }
    }

    // Toggle button click handler
    toggleButton.addEventListener('click', function() {
        if (controlsWrapper.style.display === 'none') {
            controlsWrapper.style.display = 'flex';
            toggleButton.textContent = 'Hide Helper';
            toggleButton.style.backgroundColor = '#6c757d';
        } else {
            controlsWrapper.style.display = 'none';
            toggleButton.textContent = 'Show Helper';
            toggleButton.style.backgroundColor = '#008CBA';
        }
    });

    /**
     * Handles the common post-application logic for buttons.
     * @param {HTMLElement} button The button element.
     * @param {string} originalText The original text of the button.
     * @param {string} originalColor The original background color of the button.
     */
    function handleButtonSuccess(button, originalText, originalColor) {
//        window.scrollTo(0, document.body.scrollHeight);
        button.textContent = 'Applied!';
        button.style.backgroundColor = '#28a745'; // Green for success
        setTimeout(() => {
            button.textContent = originalText;
            button.style.backgroundColor = originalColor;
        }, 2000);
    }

    /**
     * Generic handler for SNOL and New procedure buttons.
     * @param {string} suffix The suffix to append to the base procedure key (e.g., '_snol', '_new').
     * @param {HTMLElement} button The button element that was clicked.
     * @param {string} originalText The original text of the button.
     * @param {string} originalColor The original background color of the button.
     */
    async function handleProcedureButtonClick(suffix, button, originalText, originalColor) {
        const baseProcedureKey = combinedProcedureDropdown.value;
        const doctorValue = doctorDropdown.value;
        const anesthesiaValue = anesthesiaDropdown.value;

        // Validation for SNOL button: all 3 dropdowns must be selected
        if (suffix === '_snol') {
            if (!baseProcedureKey || !doctorValue || !anesthesiaValue) {
                displayMessage('Please select a procedure, doctor, and anesthesia for SNOL script!', 'error');
                return;
            }
        } else { // Validation for New button: only procedure dropdown needs to be selected
            if (!baseProcedureKey) {
                displayMessage('Please select a procedure name from the dropdown!', 'error');
                return;
            }
        }

        const templateKey = baseProcedureKey + suffix;
        const templateData = templates[templateKey];

        if (!templateData) {
            const procedureName = combinedProcedureDropdown.options[combinedProcedureDropdown.selectedIndex].text;
            const type = suffix === '_snol' ? 'SNOL' : 'New procedure';
            displayMessage(`${type} template for "${procedureName}" not found!`, 'error');
            return;
        }

        if (templateData.preClickInfo) {
            if (Array.isArray(templateData.preClickInfo)) {
                // --- Sequential, wait-based flow (fixes mobile timing gap) ---
                // Instead of guessing with fixed delays, click each pre-click
                // button in order and wait for the resulting DOM change
                // (an increase in matching element count) before moving on.
                // This is what was causing index 46 to be missed on mobile:
                // slower rendering meant the second new-row click hadn't
                // finished before applyTemplate() ran.
                try {
                    for (let i = 0; i < templateData.preClickInfo.length; i++) {
                        const clickInfo = templateData.preClickInfo[i];
                        const targetButtons = document.getElementsByClassName(clickInfo.selector);
                        const targetButton = targetButtons[clickInfo.index];

                        if (!targetButton) {
                            displayMessage(`Pre-click button with class "${clickInfo.selector}" at index ${clickInfo.index} not found!`, 'error');
                            return;
                        }

                        // Snapshot the note-editable count before clicking,
                        // so we know how many more we expect afterward.
                        const countBefore = document.querySelectorAll('.note-editable.card-block').length;

                        targetButton.click();

                        // Only the "tr_add_append_evolution" clicks add new
                        // evolution rows (and therefore new note-editable
                        // blocks). The first pre-click (hidden-xs khmer) just
                        // reveals/activates a section, so we still give it a
                        // short settle time, but we specifically wait for the
                        // editor count to grow after each evolution-row click.
                        if (clickInfo.selector === 'tr_add_append_evolution') {
                            await waitForNoteEditableCount(countBefore + 1, 4000);
                        } else {
                            // Small settle time for non-row-adding clicks.
                            await new Promise(resolve => setTimeout(resolve, 150));
                        }
                    }

                    // Extra small buffer after the last click before we read
                    ///write into the freshly-added editors, in case the rich
                    // text editor needs a moment to finish initializing even
                    // after the element itself exists in the DOM.
                    await new Promise(resolve => setTimeout(resolve, 150));

                    applyTemplate(templateKey);
                    handleButtonSuccess(button, originalText, originalColor);
                } catch (err) {
                    console.error('SNOL Helper: pre-click sequence failed:', err);
                    displayMessage('Timed out waiting for the page to update — please try again.', 'error');
                }

            } else { // For single pre-click (e.g., 'SNOL' procedures)
                const preClickSelector = templateData.preClickInfo.selector;
                const preClickIndex = templateData.preClickInfo.index;

                const targetButtons = document.getElementsByClassName(preClickSelector);
                const targetButton = targetButtons[preClickIndex];

                if (targetButton) {
                    targetButton.click();
                    setTimeout(() => {
                        applyTemplate(templateKey);
                        handleButtonSuccess(button, originalText, originalColor);
                    }, 300);
                } else {
                    displayMessage(`Target button for pre-click with class "${preClickSelector}" at index ${preClickIndex} not found!`, 'error');
                }
            }
        } else { // No pre-click info
            applyTemplate(templateKey);
            handleButtonSuccess(button, originalText, originalColor);
        }
    }

    // SNOL Button click handler
    btnSNOL.addEventListener('click', () => handleProcedureButtonClick('_snol', btnSNOL, 'Run SNOL', '#008CBA')); // Updated original text for hover effect

    // New Procedure Button click handler
    btnNew.addEventListener('click', () => handleProcedureButtonClick('_new', btnNew, 'Run Evaluation', '#DAA520')); // Updated original text for hover effect

    /**
     * Applies hover effects to a button.
     * @param {HTMLElement} button The button element.
     * @param {string} defaultColor The default background color.
     * @param {string} hoverColor The background color on hover.
     * @param {string} textToCheck The text content to check before applying hover effects.
     */
    function addHoverEffects(button, defaultColor, hoverColor, textToCheck) {
        button.addEventListener('mouseenter', function() {
            if (button.textContent === textToCheck) {
                button.style.backgroundColor = hoverColor;
            }
        });
        button.addEventListener('mouseleave', function() {
            if (button.textContent === textToCheck) {
                button.style.backgroundColor = defaultColor;
            }
        });
    }

    // Apply hover effects using the helper function
    addHoverEffects(btnSNOL, '#008CBA', '#007B9A', 'Run SNOL'); // Updated textToCheck
    addHoverEffects(btnNew, '#DAA520', '#B8860B', 'Run Evaluation'); // Updated textToCheck
    addHoverEffects(toggleButton, '#6c757d', '#5a6268', 'Hide Helper');
    addHoverEffects(toggleButton, '#008CBA', '#007B9A', 'Show Helper');

    /**
     * Displays a temporary message on the screen.
     * @param {string} message The message to display.
     * @param {string} type The type of message ('success', 'error', 'info').
     */
    function displayMessage(message, type) {
        const messageBox = document.createElement('div');
        Object.assign(messageBox.style, {
            position: 'fixed',
            top: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '10px 20px',
            borderRadius: '5px',
            color: 'white',
            fontWeight: 'bold',
            zIndex: 10000,
            opacity: 0,
            transition: 'opacity 0.5s ease-in-out',
            boxShadow: '0 4px 8px rgba(0,0,0,0.2)'
        });

        if (type === 'success') {
            messageBox.style.backgroundColor = '#28a745';
        } else if (type === 'error') {
            messageBox.style.backgroundColor = '#dc3545';
        } else {
            messageBox.style.backgroundColor = '#007bff';
        }

        messageBox.textContent = message;
        document.body.appendChild(messageBox);

        setTimeout(() => {
            messageBox.style.opacity = 1;
        }, 10);

        setTimeout(() => {
            messageBox.style.opacity = 0;
            setTimeout(() => {
                messageBox.remove();
            }, 500);
        }, 3000);
    }

})();
