/* ============================================================================
 * DEMS | Mock Data Layer v4 — RFP Modules 1-11 + Vendor Portal
 * Maps 1:1 to YARP gateway endpoints; localStorage-persisted demo DB.
 * ========================================================================== */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'dems_demo_v6';

  /* ---------- Reference masters (Module 10) — drive ALL dropdowns ---------- */
  const EQUIPMENT_MASTER = [
    { code: 'EQ-VEN-01', name: 'Ventilator', spec: 'ICU Ventilator, adult/pediatric', rate: 3.0, dept: 'ICU', category: 'Life Support', fac: ['Hospital', 'Medical College'] },
    { code: 'EQ-ECG-02', name: 'ECG Machine', spec: '12-channel digital ECG', rate: 0.6, dept: 'General', category: 'Diagnostic', fac: ['Hospital', 'Medical College', 'CHC', 'PHC'] },
    { code: 'EQ-MON-03', name: 'Patient Monitor', spec: '5-para monitor with NIBP/SpO2', rate: 0.85, dept: 'ICU', category: 'Monitoring', fac: ['Hospital', 'Medical College', 'CHC'] },
    { code: 'EQ-XRY-04', name: 'X-Ray Machine', spec: '500mA HF with flat panel', rate: 14.5, dept: 'Radiology', category: 'Imaging', fac: ['Hospital', 'Medical College'] },
    { code: 'EQ-OXY-05', name: 'Oxygen Concentrator', spec: '10L dual outlet with backup', rate: 0.72, dept: 'General', category: 'Life Support', fac: ['Hospital', 'Medical College', 'CHC', 'PHC'] },
    { code: 'EQ-MRI-06', name: 'MRI Scanner', spec: '1.5T closed bore', rate: 320.0, dept: 'Radiology', category: 'Imaging', fac: ['Hospital', 'Medical College'] },
    { code: 'EQ-ULT-07', name: 'Ultrasound Machine', spec: '3-probe colour doppler', rate: 9.8, dept: 'Radiology', category: 'Imaging', fac: ['Hospital', 'Medical College', 'CHC'] },
    { code: 'EQ-ANA-08', name: 'Anaesthesia Workstation', spec: 'With ventilator + monitors', rate: 18.5, dept: 'Anaesthesia', category: 'Surgical', fac: ['Hospital', 'Medical College'] }
  ];
  const INSTITUTION_MASTER = [
    { code: 'INST-HYD-DH', name: 'District Hospital, Hyderabad', district: 'Hyderabad', fac: 'Hospital', hod: 'HoD Facility — Directorate' },
    { code: 'INST-KKP-PHC', name: 'PHC Kukatpally', district: 'Medchal', fac: 'PHC', hod: 'HoD Facility — Directorate' },
    { code: 'INST-NZB-GMC', name: 'Government Medical College, Nizamabad', district: 'Nizamabad', fac: 'Medical College', hod: 'HoD Facility — Directorate' },
    { code: 'INST-WGL-CHC', name: 'CHC Warangal', district: 'Warangal', fac: 'CHC', hod: 'HoD Facility — Directorate' },
    { code: 'INST-KNR-DH', name: 'District Hospital, Karimnagar', district: 'Karimnagar', fac: 'Hospital', hod: 'HoD Facility — Directorate' },
    { code: 'INST-HYD-GH', name: 'Government Hospital, Hyderabad', district: 'Hyderabad', fac: 'Hospital', hod: 'HoD Facility — Directorate' }
  ];
  const LOOKUPS = {
    facilityTypes: ['District Hospital', 'PHC', 'CHC', 'Medical College', 'HoD Facility — Directorate'],
    districts: ['Hyderabad', 'Medchal', 'Nizamabad', 'Warangal', 'Karimnagar'],
    indentTypes: ['Letter', 'GO', 'Proceeding'],
    programmes: ['Health Infrastructure', 'Medical Education', 'Family Welfare', 'Tertiary Care', 'National Health Mission'],
    fundSources: ['State Budget', 'Central Grant', 'NHM Flexi Pool', 'External Aid'],
    accountHeads: ['Medical Equipment', 'Equipment Replacement', 'High-end Equipment', 'Consumables & Accessories'],
    docTypes: ['Administrative Approval', 'Requirement / Justification Letter', 'Technical Specification Sheet', 'Budget Sanction Copy'],
    priorities: ['Normal', 'Urgent', 'Emergency'],
    tenderStages: ['Tender Opened', 'Technical Evaluation', 'Price Bid Opened', 'BFC Decision'],
    specModes: ['Accepted', 'Changed', 'New'],
    poModes: ['RC', 'Tender', 'Local Purchase'],
    gstSlabs: [5, 12, 18, 28],
    tcTemplates: ['Standard Medical Equipment T&C v3', 'High-value Turnkey T&C', 'Local Purchase T&C'],
    qaDecisions: ['Accepted', 'Conditionally Accepted', 'Rejected']
  };
  const VENDOR_MASTER = [
    { code: 'V-ABC', name: 'ABC Medical Systems', contact: 'abc@med.in · 98480 11111', rating: 4.6 },
    { code: 'V-XYZ', name: 'XYZ Healthcare', contact: 'care@xyz.in · 98480 22222', rating: 4.2 },
    { code: 'V-MED', name: 'MedEquip India', contact: 'sales@medequip.in · 98480 33333', rating: 3.9 },
    { code: 'V-SHK', name: 'Shakti Devices', contact: 'info@shakti.in · 98480 44444', rating: 4.4 }
  ];
  /* ---- Master registry (RFP Master List): schema + ownership per master ---- */
  const MASTER_DEFS = [
    { key: 'Equipment', icon: '▦', idPrefix: 'EQ', maintainedBy: 'TGMSIDC Admin', updateFreq: 'As needed (GM approval for additions)', usedIn: 'Indent, RC, PO, QA', fields: [
      { k: 'code', label: 'Equipment ID', type: 'text', req: 1, id: 1 }, { k: 'name', label: 'Name', type: 'text', req: 1 },
      { k: 'facilityType', label: 'Facility Type', type: 'select', opts: ['Medical College', 'Hospital', 'PHC', 'CHC', 'HoD Facility'] },
      { k: 'category', label: 'Category', type: 'select', opts: ['Diagnostic', 'Imaging', 'Life Support', 'Laboratory', 'Surgical', 'IT & Accessories'] },
      { k: 'department', label: 'Department', type: 'text' }, { k: 'hsn', label: 'HSN Code', type: 'text' },
      { k: 'specTemplate', label: 'Specifications Template', type: 'textarea' }, { k: 'cost', label: 'Cost / unit (₹ Lakh)', type: 'number' },
      { k: 'active', label: 'Active (Y/N)', type: 'select', opts: ['Y', 'N'] } ] },
    { key: 'Institutions', icon: '⌂', idPrefix: 'INST', maintainedBy: 'TGMSIDC Admin', updateFreq: 'Annually / As needed', usedIn: 'Indent, PO (consignee), Delivery', fields: [
      { k: 'code', label: 'Institution ID', type: 'text', req: 1, id: 1 }, { k: 'name', label: 'Name', type: 'text', req: 1 },
      { k: 'facilityType', label: 'Facility Type', type: 'select', opts: ['Medical College', 'Hospital', 'PHC', 'CHC', 'HoD Facility'] },
      { k: 'district', label: 'District', type: 'select', opts: ['Hyderabad', 'Medchal', 'Nizamabad', 'Warangal', 'Karimnagar'] },
      { k: 'address', label: 'Full Address', type: 'textarea' }, { k: 'contactPerson', label: 'Contact Person', type: 'text' },
      { k: 'phone', label: 'Phone', type: 'tel' }, { k: 'email', label: 'Email', type: 'email' },
      { k: 'active', label: 'Active (Y/N)', type: 'select', opts: ['Y', 'N'] } ] },
    { key: 'Vendors', icon: '♙', idPrefix: 'V', maintainedBy: 'TGMSIDC Admin', updateFreq: 'As needed (post tender)', usedIn: 'RC, PO, Delivery, QA, Vendor Portal', fields: [
      { k: 'code', label: 'Vendor ID', type: 'text', req: 1, id: 1 }, { k: 'name', label: 'Company Name', type: 'text', req: 1 },
      { k: 'gstin', label: 'GSTIN', type: 'text' }, { k: 'pan', label: 'PAN', type: 'text' },
      { k: 'address', label: 'Registered Address', type: 'textarea' }, { k: 'contactPerson', label: 'Contact Person', type: 'text' },
      { k: 'phone', label: 'Phone', type: 'tel' }, { k: 'email', label: 'Email', type: 'email' },
      { k: 'bank', label: 'Bank Details', type: 'text' }, { k: 'score', label: 'Performance Score (0-5)', type: 'number' },
      { k: 'portalId', label: 'Portal Login ID', type: 'text' }, { k: 'portalStatus', label: 'Portal Status', type: 'select', opts: ['Active', 'Inactive'] },
      { k: 'lastLogin', label: 'Last Login Date', type: 'date' }, { k: 'notifyPref', label: 'Notification Preference', type: 'select', opts: ['Email', 'Portal', 'Both'] } ] },
    { key: 'Account Heads', icon: '₹', idPrefix: 'AH', maintainedBy: 'TGMSIDC Admin', updateFreq: 'Annually', usedIn: 'Indent', fields: [
      { k: 'code', label: 'Account Head ID', type: 'text', req: 1, id: 1 }, { k: 'name', label: 'Name', type: 'text', req: 1 },
      { k: 'description', label: 'Description', type: 'textarea' }, { k: 'budgetCode', label: 'Budget Code', type: 'text' },
      { k: 'active', label: 'Active (Y/N)', type: 'select', opts: ['Y', 'N'] } ] },
    { key: 'Programmes', icon: '◆', idPrefix: 'P', maintainedBy: 'TGMSIDC Admin', updateFreq: 'Annually', usedIn: 'Indent', fields: [
      { k: 'code', label: 'Programme ID', type: 'text', req: 1, id: 1 }, { k: 'name', label: 'Name', type: 'text', req: 1 },
      { k: 'fundingSource', label: 'Funding Source (linked)', type: 'select', opts: ['State Budget', 'Central Grant', 'NHM Flexi Pool', 'External Aid'] },
      { k: 'validity', label: 'Validity Period', type: 'text' }, { k: 'budget', label: 'Budget Allocation (₹ Cr)', type: 'number' } ] },
    { key: 'Funding Sources', icon: '◈', idPrefix: 'FS', maintainedBy: 'TGMSIDC Admin', updateFreq: 'As needed', usedIn: 'Indent (via Programme)', fields: [
      { k: 'code', label: 'Source ID', type: 'text', req: 1, id: 1 }, { k: 'name', label: 'Name', type: 'text', req: 1 },
      { k: 'type', label: 'Type', type: 'select', opts: ['State', 'Central', 'Externally Aided'] },
      { k: 'description', label: 'Description', type: 'textarea' } ] },
    { key: 'Indent Types', icon: '▤', idPrefix: 'IT', maintainedBy: 'TGMSIDC Admin', updateFreq: 'Rarely', usedIn: 'Indent', fields: [
      { k: 'code', label: 'Type ID', type: 'text', req: 1, id: 1 }, { k: 'name', label: 'Name', type: 'text', req: 1 },
      { k: 'description', label: 'Description (Letter / GO / Proceeding)', type: 'textarea' } ] },
    { key: 'Authorities', icon: '♙', idPrefix: 'AU', maintainedBy: 'TGMSIDC Admin', updateFreq: 'As needed', usedIn: 'Indent, Approval workflows', fields: [
      { k: 'code', label: 'Authority ID', type: 'text', req: 1, id: 1 }, { k: 'name', label: 'Name', type: 'text', req: 1 },
      { k: 'designation', label: 'Designation', type: 'text' }, { k: 'department', label: 'Department', type: 'text' },
      { k: 'contact', label: 'Contact Details', type: 'text' },
      { k: 'level', label: 'Approval Level', type: 'select', opts: ['DEO (Initiate)', 'TGMSIDC (Verify)', 'GM (Propose)', 'SO (Approve)', 'ED (Final)'] } ] },
    { key: 'Districts', icon: '⌂', idPrefix: 'D', maintainedBy: 'System (static)', updateFreq: 'Rarely', usedIn: 'Institution linkage', fields: [
      { k: 'code', label: 'District ID', type: 'text', req: 1, id: 1 }, { k: 'name', label: 'District Name', type: 'text', req: 1 },
      { k: 'state', label: 'State', type: 'text' }, { k: 'region', label: 'Region / Zone', type: 'text' } ] },
    { key: 'Tax / GST Slabs', icon: '▤', idPrefix: 'GST', maintainedBy: 'TGMSIDC Admin', updateFreq: 'As per govt. notification', usedIn: 'RC, PO (cost calculation)', fields: [
      { k: 'code', label: 'Tax ID', type: 'text', req: 1, id: 1 }, { k: 'name', label: 'Tax Type', type: 'select', opts: ['GST', 'IGST', 'CGST+SGST', 'Exempt'] },
      { k: 'slab', label: 'GST Slab %', type: 'number' }, { k: 'split', label: 'IGST / CGST+SGST rates', type: 'text' },
      { k: 'hsnRange', label: 'HSN Range', type: 'text' }, { k: 'effective', label: 'Effective Date', type: 'date' } ] },
    { key: 'T&C Templates', icon: '▥', idPrefix: 'TC', maintainedBy: 'TGMSIDC Admin', updateFreq: 'As needed', usedIn: 'PO (T&C, Annexures)', fields: [
      { k: 'code', label: 'Template ID', type: 'text', req: 1, id: 1 }, { k: 'name', label: 'Name', type: 'text', req: 1 },
      { k: 'poType', label: 'PO Type', type: 'select', opts: ['Standard', 'RC-linked', 'Tender-linked', 'Local Purchase', 'Turnkey'] },
      { k: 'clauses', label: 'Clause List', type: 'textarea' }, { k: 'locked', label: 'Locked Clauses', type: 'select', opts: ['None', 'Payment terms', 'Warranty terms', 'All standard'] },
      { k: 'version', label: 'Version', type: 'text' }, { k: 'effective', label: 'Effective Date', type: 'date' } ] },
    { key: 'Users & Roles', icon: '⚙', idPrefix: 'U', maintainedBy: 'System Admin', updateFreq: 'As needed', usedIn: 'All modules (access control), Vendor Portal, DEO indent entry', fields: [
      { k: 'code', label: 'User ID', type: 'text', req: 1, id: 1 }, { k: 'name', label: 'Full Name', type: 'text', req: 1 },
      { k: 'role', label: 'Role', type: 'select', opts: ['Admin', 'TGMSIDC User', 'GM Equipment', 'SO Equipment', 'ED', 'DEO (HoD)', 'Consignee', 'Vendor Portal'] },
      { k: 'hod', label: 'HoD Mapping (for DEO role)', type: 'text' }, { k: 'access', label: 'Module Access', type: 'text' },
      { k: 'active', label: 'Status', type: 'select', opts: ['Active', 'Inactive'] } ] }
  ];
  /* 15 reports + 12 KPIs (Module 11) */
  const REPORT_CATALOG = [
    ['01', 'Indent Status Report', 'Submission, verification and approval status'],
    ['02', 'Approval TAT Report', 'Stage-wise processing time and SLA adherence'],
    ['03', 'Rate Contract Report', 'Active, expired, renewal and amendments'],
    ['04', 'Vendor Performance', 'Delivery, quality and acceptance metrics'],
    ['05', 'Delivery Delay Report', 'Delayed orders and discrepancy analysis'],
    ['06', 'QA Acceptance Report', 'Accepted, conditional and rejected equipment'],
    ['07', 'Procurement Lifecycle', 'Indent-to-acceptance complete journey'],
    ['08', 'Payment Status', 'Paid / Not-Paid equipment tracking'],
    ['09', 'Tender Lifecycle Report', 'Tender stages through BFC decision'],
    ['10', 'RC Expiry & Renewal', '90/60/30/0-day alerts and renewals'],
    ['11', 'PO Amendment Register', 'Version history and re-approvals'],
    ['12', 'Consignee Receipt Report', 'Serial-level receipt by institution'],
    ['13', 'Warranty Expiry Report', 'Warranty start/end tracking'],
    ['14', 'Grievance & Clarifications', 'Vendor tickets and resolution TAT'],
    ['15', 'Fund Utilisation Report', 'Programme / source / head-wise spend']
  ];
  const KPI_CATALOG = [
    ['Indents this FY', '1,253', '↑ 12.4%'], ['Avg. approval TAT', '6.2 days', '↓ 0.8d'],
    ['Active RCs', '84', '12 expiring'], ['PO value FY', '₹48.62 Cr', '↑ 9%'],
    ['On-time delivery', '87%', '↑ 3pp'], ['QA acceptance', '94%', '↑ 1pp'],
    ['Discrepancies open', '12', '4 critical'], ['Vendors rated ≥4', '212', 'of 318'],
    ['DCC uploaded', '96%', '↑ 2pp'], ['Warranty live', '1,042', 'units'],
    ['Grievances open', '7', 'SLA 2 breached'], ['Paid POs', '68%', 'rest Not-Paid']
  ];
  global.DEMS_MASTERS = { EQUIPMENT_MASTER, INSTITUTION_MASTER, LOOKUPS, VENDOR_MASTER, REPORT_CATALOG, KPI_CATALOG, MASTER_DEFS };

  /* ---------- Seed v4 -------------------------------- */
  function seed() {
    return {
      meta: { fy: '2026-27', seededAt: new Date().toISOString() },
      indents: [
        { id: 'IND-2026-00124', trackingId: 'TRK-2026-0124', receiptTs: '05-Oct-2026 10:15', refNo: 'HOD/DH-HYD/2026/118', indentDate: '2026-10-03', facility: 'District Hospital, Hyderabad', district: 'Hyderabad', hodFacility: 'HoD Facility — Directorate', deo: 'DEO · S. Rao', type: 'Letter', priority: 'Normal', fy: '2026-27', institutions: ['District Hospital, Hyderabad', 'Government Hospital, Hyderabad'], items: [{ masterCode: 'EQ-VEN-01', equipment: 'Ventilator', dept: 'ICU', spec: 'ICU Ventilator, adult/pediatric', qty: 15, cost: 45.0, writeIn: false, resolution: '', mode: 'RC', verdict: 'Verified', consignees: [{ institution: 'District Hospital, Hyderabad', qty: 10 }, { institution: 'Government Hospital, Hyderabad', qty: 5 }] }, { masterCode: 'EQ-ECG-02', equipment: 'ECG Machine', dept: 'General', spec: '12-channel digital ECG', qty: 20, cost: 12.0, writeIn: false, resolution: '', mode: 'RC', verdict: 'Verified', consignees: [{ institution: 'District Hospital, Hyderabad', qty: 20 }] }], valueLakh: 24.8, submitted: '05-Oct-2026', status: 'Pending TGMSIDC Review', programme: 'Health Infrastructure', source: 'State Budget', head: 'Medical Equipment', funds: [{ institution: 'District Hospital, Hyderabad', sanctioned: 45.0, sanctionDate: '2026-09-20', deposited: 45.0, utr: 'UTR/HDFC/88213', depositDate: '2026-09-25' }, { institution: 'Government Hospital, Hyderabad', sanctioned: 12.0, sanctionDate: '2026-09-21', deposited: 0, utr: '', depositDate: '' }], docs: [{ name: 'Administrative Approval.pdf', type: 'Administrative Approval', sizeMB: 1.2 }, { name: 'Requirement Letter.pdf', type: 'Requirement / Justification Letter', sizeMB: 0.8 }], editHistory: [], returnComments: '', gmRemarks: '', soRemarks: '' },
        { id: 'IND-2026-00125', trackingId: 'TRK-2026-0125', receiptTs: '04-Oct-2026 15:40', refNo: 'HOD/PHC-KKP/2026/042', indentDate: '2026-10-02', facility: 'PHC Kukatpally', district: 'Medchal', hodFacility: 'HoD Facility — Directorate', deo: 'DEO · K. Reddy', type: 'Letter', priority: 'Normal', fy: '2026-27', institutions: ['PHC Kukatpally'], items: [{ masterCode: 'EQ-MON-03', equipment: 'Patient Monitor', dept: 'ICU', spec: '5-para monitor', qty: 12, cost: 8.2, writeIn: false, resolution: '', mode: '', verdict: 'Review', consignees: [{ institution: 'PHC Kukatpally', qty: 12 }] }], valueLakh: 8.2, submitted: '04-Oct-2026', status: 'Draft', programme: 'Family Welfare', source: 'State Budget', head: 'Medical Equipment', funds: [], docs: [], editHistory: [], returnComments: '', gmRemarks: '', soRemarks: '' },
        { id: 'IND-2026-00126', trackingId: 'TRK-2026-0126', receiptTs: '03-Oct-2026 11:05', refNo: 'GO.Ms.No.214/2026', indentDate: '2026-09-28', facility: 'Government Medical College, Nizamabad', district: 'Nizamabad', hodFacility: 'HoD Facility — Directorate', deo: 'DEO · P. Rao', type: 'GO', priority: 'Urgent', fy: '2026-27', institutions: ['Government Medical College, Nizamabad'], items: [{ masterCode: 'EQ-XRY-04', equipment: 'X-Ray Machine', dept: 'Radiology', spec: '500mA HF', qty: 32, cost: 46.5, writeIn: false, resolution: '', mode: 'Tender', verdict: 'Verified', consignees: [{ institution: 'Government Medical College, Nizamabad', qty: 32 }] }], valueLakh: 46.5, submitted: '03-Oct-2026', status: 'Verified', programme: 'Medical Education', source: 'Central Grant', head: 'Equipment Replacement', funds: [{ institution: 'Government Medical College, Nizamabad', sanctioned: 46.5, sanctionDate: '2026-09-15', deposited: 46.5, utr: 'UTR/SBI/77120', depositDate: '2026-09-22' }], docs: [{ name: 'Requirement Letter.pdf', type: 'Requirement / Justification Letter', sizeMB: 0.6 }], editHistory: [], returnComments: '', gmRemarks: 'High value — fresh tender', soRemarks: '' },
        { id: 'IND-2026-00127', trackingId: 'TRK-2026-0127', receiptTs: '02-Oct-2026 09:30', refNo: 'HOD/CHC-WGL/2026/091', indentDate: '2026-09-30', facility: 'CHC Warangal', district: 'Warangal', hodFacility: 'HoD Facility — Directorate', deo: 'DEO · M. Ali', type: 'Proceeding', priority: 'Normal', fy: '2026-27', institutions: ['CHC Warangal'], items: [{ masterCode: 'EQ-OXY-05', equipment: 'Oxygen Concentrator', dept: 'General', spec: '10L dual outlet', qty: 25, cost: 18.4, writeIn: false, resolution: '', mode: 'RC', verdict: 'Verified', consignees: [{ institution: 'CHC Warangal', qty: 25 }] }], valueLakh: 18.4, submitted: '02-Oct-2026', status: 'Approved · RC', programme: 'Health Infrastructure', source: 'State Budget', head: 'Medical Equipment', funds: [{ institution: 'CHC Warangal', sanctioned: 18.4, sanctionDate: '2026-09-18', deposited: 18.4, utr: 'UTR/HDFC/88001', depositDate: '2026-09-24' }], docs: [{ name: 'Administrative Approval.pdf', type: 'Administrative Approval', sizeMB: 1.0 }], editHistory: [], returnComments: '', gmRemarks: '', soRemarks: '' },
        { id: 'IND-2026-00128', trackingId: 'TRK-2026-0128', receiptTs: '01-Oct-2026 14:20', refNo: 'HOD/DH-KNR/2026/077', indentDate: '2026-09-29', facility: 'District Hospital, Karimnagar', district: 'Karimnagar', hodFacility: 'HoD Facility — Directorate', deo: 'DEO · S. Rao', type: 'Letter', priority: 'Emergency', fy: '2026-27', institutions: ['District Hospital, Karimnagar'], items: [{ masterCode: '__WRITEIN__', equipment: 'Portable Dialysis Unit', dept: 'Nephrology', spec: 'Write-in: bedside dialysis, 2-probe', qty: 1, cost: 320.0, writeIn: true, resolution: 'New Addition Requested', mode: 'Tender', verdict: 'Review', consignees: [{ institution: 'District Hospital, Karimnagar', qty: 1 }] }], valueLakh: 320.0, submitted: '01-Oct-2026', status: 'Approved · Tender', programme: 'Tertiary Care', source: 'Central Grant', head: 'High-end Equipment', funds: [{ institution: 'District Hospital, Karimnagar', sanctioned: 320.0, sanctionDate: '2026-09-10', deposited: 0, utr: '', depositDate: '' }], docs: [{ name: 'Administrative Approval.pdf', type: 'Administrative Approval', sizeMB: 1.4 }, { name: 'Tech Spec.pdf', type: 'Technical Specification Sheet', sizeMB: 2.1 }], editHistory: [], returnComments: '', gmRemarks: '', soRemarks: '' }
      ],
      /* Module 3 + 4: RC creation + management */
      rcs: [
        { no: 'RC/2026/001', vendor: 'ABC Medical Systems', equipment: 'Ventilator', specStatus: 'Accepted', specNote: 'Doctor confirmed ICU spec', tenderStage: 'BFC Approved', tenderHistory: ['Tender Opened', 'Technical Evaluation', 'Price Bid Opened', 'BFC Decision'], bfc: 'Approved', validFrom: '16-Dec-2025', validTill: '15-Dec-2026', daysLeft: 70, camc: '3 Years', camcRate: 8, basicRate: 298000, gstPct: 12, status: 'Active', approval: 'SO Approved', predecessor: null, versions: [{ v: 1, note: 'Original award', approval: 'SO Approved' }], indentRef: 'IND-2026-00124' },
        { no: 'RC/2026/002', vendor: 'XYZ Healthcare', equipment: 'MRI Scanner', specStatus: 'Changed', specNote: 'Doctor revised bore spec', tenderStage: 'BFC Approved', tenderHistory: ['Tender Opened', 'Technical Evaluation', 'Price Bid Opened', 'BFC Decision'], bfc: 'Approved', validFrom: '29-Oct-2025', validTill: '28-Oct-2026', daysLeft: 22, camc: '5 Years', camcRate: 10, basicRate: 42500000, gstPct: 18, status: 'Expiring', approval: 'SO Approved', predecessor: null, versions: [{ v: 1, note: 'Original award', approval: 'SO Approved' }], indentRef: 'IND-2026-00128' },
        { no: 'RC/2025/087', vendor: 'MedEquip India', equipment: 'ECG Machine', specStatus: 'Accepted', specNote: '', tenderStage: 'BFC Approved', tenderHistory: ['Tender Opened', 'Technical Evaluation', 'Price Bid Opened', 'BFC Decision'], bfc: 'Approved', validFrom: '11-Sep-2024', validTill: '10-Sep-2026', daysLeft: -26, camc: '2 Years', camcRate: 5, basicRate: 58000, gstPct: 12, status: 'Expired', approval: 'SO Approved', predecessor: null, versions: [{ v: 1, note: 'Original award', approval: 'SO Approved' }], indentRef: '' },
        { no: 'RC/2026/008', vendor: 'Shakti Devices', equipment: 'X-Ray Machine', specStatus: 'New', specNote: 'New flat-panel spec by committee', tenderStage: 'Price Bid Opened', tenderHistory: ['Tender Opened', 'Technical Evaluation', 'Price Bid Opened'], bfc: 'Pending', validFrom: '31-Mar-2026', validTill: '30-Mar-2027', daysLeft: 175, camc: '3 Years', camcRate: 7, basicRate: 1450000, gstPct: 18, status: 'Active', approval: 'GM Proposed', predecessor: null, versions: [{ v: 1, note: 'Award pending SO approval', approval: 'GM Proposed' }], indentRef: 'IND-2026-00126' }
      ],
      /* Modules 5-7: PO generation, approval, amendment/cancellation */
      pos: [
        { no: 'PO/2026/00452', indent: 'IND-2026-00124', rc: 'RC/2026/001', equipment: 'Ventilator', lines: [{ vendor: 'ABC Medical Systems', rank: 'L1', qty: 10, rate: 298000 }, { vendor: 'XYZ Healthcare', rank: 'L2', qty: 5, rate: 305000 }], valueLakh: 32.92, gstPct: 12, perfSecurity: '5% bank guarantee', tc: 'Standard Medical Equipment T&C v3', consignees: [{ institution: 'District Hospital, Hyderabad', qty: 10 }, { institution: 'Government Hospital, Hyderabad', qty: 5 }], approval: 'ED Approved', chain: { gm: 'Proposed', so: 'Approved', ed: 'Approved' }, status: 'Pending Dispatch', ack: 'Acknowledged', versions: [{ v: 1, note: 'Original issue', approval: 'ED Approved' }], anomalies: [], indentQtyFreed: 0 },
        { no: 'PO/2026/00451', indent: 'IND-2026-00118', rc: 'RC/2026/008', equipment: 'X-Ray Machine', lines: [{ vendor: 'Shakti Devices', rank: 'L1', qty: 8, rate: 1450000 }], valueLakh: 18.4, gstPct: 18, perfSecurity: '5% bank guarantee', tc: 'High-value Turnkey T&C', consignees: [{ institution: 'GMC Nizamabad', qty: 8 }], approval: 'SO Approved', chain: { gm: 'Proposed', so: 'Approved', ed: 'Not required (< ₹25L slab demo)' }, status: 'Approved', ack: 'Pending', versions: [{ v: 1, note: 'Original issue', approval: 'SO Approved' }], anomalies: [], indentQtyFreed: 0 },
        { no: 'PO/2026/00449', indent: 'IND-2026-00115', rc: 'RC/2025/087', equipment: 'ECG Machine', lines: [{ vendor: 'MedEquip India', rank: 'L1', qty: 20, rate: 58000 }], valueLakh: 11.6, gstPct: 12, perfSecurity: 'Exempt (low value)', tc: 'Standard Medical Equipment T&C v3', consignees: [{ institution: 'PHC Kukatpally', qty: 20 }], approval: 'SO Approved', chain: { gm: 'Proposed', so: 'Approved', ed: 'Not required' }, status: 'Partially Received', ack: 'Acknowledged', versions: [{ v: 1, note: 'Original issue', approval: 'SO Approved' }], anomalies: ['Rate 4% above RC band (waived)'], indentQtyFreed: 0 }
      ],
      /* Module 8: Delivery & Receipt */
      deliveries: [
        { po: 'PO/2026/00452', vendor: 'ABC Medical Systems', equipment: 'Ventilator', expected: 15, received: 15, status: 'Complete', dispatch: { date: '28-Sep-2026', lr: 'LR-88412', confirmed: true }, serials: [{ serial: 'VM-26-00145', model: 'VENT-X500', condition: 'Good' }, { serial: 'VM-26-00146', model: 'VENT-X500', condition: 'Good' }], dcc: { name: 'DCC_PO00452.pdf', by: 'Vendor Portal · 1.8 MB' }, photos: 4, discrepancies: [] },
        { po: 'PO/2026/00449', vendor: 'MedEquip India', equipment: 'ECG Machine', expected: 20, received: 18, status: 'Discrepancy', dispatch: { date: '30-Sep-2026', lr: 'LR-88501', confirmed: true }, serials: [{ serial: 'ECG-26-00011', model: 'ECG-12C', condition: 'Good' }], dcc: { name: '', by: '' }, photos: 2, discrepancies: [{ desc: 'Short supply: 2 units; 1 unit screen flicker', photo: 'damage-01.jpg' }] }
      ],
      /* Module 9: QA & Acceptance (multi-record) */
      qas: [
        { po: 'PO/2026/00452', equipment: 'Ventilator', qty: 15, vendor: 'ABC Medical Systems', stage: 'Inspection', committee: ['Dr. Rao (Chair)', 'Biomedical Eng. Kumar', 'Consignee Sister Mary'], checklist: [true, true, true, true, false, false], installDone: false, trainingDone: false, payment: 'Not-Paid', warrantyStart: '', warrantyPeriod: '36 Months', inspectionDate: '05-Oct-2026', decision: '', history: [] },
        { po: 'PO/2026/00449', equipment: 'ECG Machine', qty: 20, vendor: 'MedEquip India', stage: 'Accepted with Conditions', committee: ['Dr. Iyer (Chair)', 'Biomedical Eng. Das'], checklist: [true, true, true, false, true, true], installDone: true, trainingDone: true, payment: 'Not-Paid', warrantyStart: '02-Oct-2026', warrantyPeriod: '24 Months', inspectionDate: '02-Oct-2026', decision: 'Conditionally Accepted', history: [{ dt: '02-Oct-2026', act: 'Conditionally accepted — replace flicker unit in 15 days' }] }
      ],
      /* Module 10: Master Data Management (RFP Master List — full key fields) */
      masterRecords: {
        Equipment: [
          { code: 'EQ-VEN-01', name: 'Ventilator', facilityType: 'Hospital', category: 'Life Support', department: 'ICU', hsn: '9018.90', specTemplate: 'ICU ventilator adult/pediatric, 3 modes, backup battery', cost: 3.0, active: 'Y', status: 'Active' },
          { code: 'EQ-ECG-02', name: 'ECG Machine', facilityType: 'PHC', category: 'Diagnostic', department: 'General', hsn: '9018.11', specTemplate: '12-channel digital ECG with interpretation', cost: 0.6, active: 'Y', status: 'Active' },
          { code: 'EQ-NEW-09', name: 'Portable Dialysis Unit (write-in)', facilityType: 'Hospital', category: 'Life Support', department: 'Nephrology', hsn: '9018.90', specTemplate: 'Bedside dialysis, 2-probe (awaiting GM approval)', cost: 9.5, active: 'Y', status: 'Pending Approval' }],
        Institutions: [
          { code: 'INST-HYD-DH', name: 'District Hospital, Hyderabad', facilityType: 'Hospital', district: 'Hyderabad', address: 'Sultan Bazar, Hyderabad 500095', contactPerson: 'Dr. S. Reddy (Supdt.)', phone: '040-2475 8899', email: 'dh-hyd@tgmsidc.in', active: 'Y', status: 'Active' },
          { code: 'INST-KKP-PHC', name: 'PHC Kukatpally', facilityType: 'PHC', district: 'Medchal', address: 'Kukatpally, Medchal 500072', contactPerson: 'Dr. K. Rani (MO)', phone: '040-2305 1122', email: 'phc-kkp@tgmsidc.in', active: 'Y', status: 'Active' },
          { code: 'INST-NZB-GMC', name: 'Government Medical College, Nizamabad', facilityType: 'Medical College', district: 'Nizamabad', address: 'Nizamabad 503001', contactPerson: 'Dr. P. Rao (Principal)', phone: '08462-223344', email: 'gmc-nzb@tgmsidc.in', active: 'Y', status: 'Active' }],
        Vendors: [
          { code: 'V-ABC', name: 'ABC Medical Systems', gstin: '36ABCDE1234F1Z5', pan: 'ABCDE1234F', address: 'Banjara Hills Rd 12, Hyderabad', contactPerson: 'A. Sharma', phone: '98480 11111', email: 'abc@med.in', bank: 'HDFC A/c 50200011 IFSC HDFC00012', score: 4.6, portalId: 'abc.vendor', portalStatus: 'Active', lastLogin: '2026-10-04', notifyPref: 'Both', status: 'Active' },
          { code: 'V-XYZ', name: 'XYZ Healthcare', gstin: '36XYZHE5678G2Z3', pan: 'XYZHE5678G', address: 'Hitech City, Hyderabad', contactPerson: 'R. Iyer', phone: '98480 22222', email: 'care@xyz.in', bank: 'SBI A/c 33001122', score: 4.2, portalId: 'xyz.vendor', portalStatus: 'Active', lastLogin: '2026-10-03', notifyPref: 'Email', status: 'Active' },
          { code: 'V-NEW', name: 'Nova Surgicals (applied)', gstin: '36NOVAS9012H3Z1', pan: 'NOVAS9012H', address: 'Dilshuknagar, Hyderabad', contactPerson: 'N. Gupta', phone: '98480 55555', email: 'nova@surg.in', bank: 'Pending verification', score: 0, portalId: '', portalStatus: 'Inactive', lastLogin: '', notifyPref: 'Email', status: 'Pending Approval' }],
        'Account Heads': [
          { code: 'AH-01', name: 'Medical Equipment', description: 'General equipment procurement', budgetCode: 'MED-EQ-01', active: 'Y', status: 'Active' },
          { code: 'AH-02', name: 'High-end Equipment', description: 'Imaging and tertiary-care equipment', budgetCode: 'MED-HE-02', active: 'Y', status: 'Active' }],
        Programmes: [
          { code: 'P-01', name: 'Health Infrastructure', fundingSource: 'State Budget', validity: '2024-2027', budget: 120, status: 'Active' },
          { code: 'P-02', name: 'Medical Education', fundingSource: 'Central Grant', validity: '2024-2026', budget: 85, status: 'Active' }],
        'Funding Sources': [
          { code: 'FS-01', name: 'State Budget', type: 'State', description: 'TG state annual health budget', status: 'Active' },
          { code: 'FS-02', name: 'Central Grant', type: 'Central', description: 'MoHFW grants-in-aid', status: 'Active' },
          { code: 'FS-03', name: 'NHM Flexi Pool', type: 'Central', description: 'NHM flexible pool for states', status: 'Active' }],
        'Indent Types': [
          { code: 'IT-01', name: 'Letter', description: 'Physical indent received as letter from HoD facility', status: 'Active' },
          { code: 'IT-02', name: 'GO', description: 'Indent backed by Government Order', status: 'Active' },
          { code: 'IT-03', name: 'Proceeding', description: 'Emergency procurement via proceeding', status: 'Active' }],
        Authorities: [
          { code: 'AU-TG', name: 'TGMSIDC Verifier', designation: 'Manager (Equipment)', department: 'TGMSIDC', contact: 'tgm-ver@tgmsidc.in', level: 'TGMSIDC (Verify)', status: 'Active' },
          { code: 'AU-GM', name: 'GM Equipment', designation: 'General Manager', department: 'TGMSIDC', contact: 'gm-eq@tgmsidc.in', level: 'GM (Propose)', status: 'Active' },
          { code: 'AU-SO', name: 'SO Equipment', designation: 'Section Officer', department: 'TGMSIDC', contact: 'so-eq@tgmsidc.in', level: 'SO (Approve)', status: 'Active' },
          { code: 'AU-ED', name: 'Executive Director', designation: 'ED', department: 'TGMSIDC', contact: 'ed@tgmsidc.in', level: 'ED (Final)', status: 'Active' }],
        Districts: [
          { code: 'D-HYD', name: 'Hyderabad', state: 'Telangana', region: 'Zone VI', status: 'Active' },
          { code: 'D-MED', name: 'Medchal', state: 'Telangana', region: 'Zone VI', status: 'Active' },
          { code: 'D-NZB', name: 'Nizamabad', state: 'Telangana', region: 'Zone V', status: 'Active' },
          { code: 'D-WGL', name: 'Warangal', state: 'Telangana', region: 'Zone V', status: 'Active' },
          { code: 'D-KNR', name: 'Karimnagar', state: 'Telangana', region: 'Zone V', status: 'Active' }],
        'Tax / GST Slabs': [
          { code: 'GST-05', name: 'GST', slab: 5, split: '2.5% CGST + 2.5% SGST / 5% IGST', hsnRange: '9018-9019 (selected)', effective: '2023-10-01', status: 'Active' },
          { code: 'GST-12', name: 'GST', slab: 12, split: '6% CGST + 6% SGST / 12% IGST', hsnRange: '9018 (devices)', effective: '2023-10-01', status: 'Active' },
          { code: 'GST-18', name: 'GST', slab: 18, split: '9% CGST + 9% SGST / 18% IGST', hsnRange: '9022 (imaging)', effective: '2023-10-01', status: 'Active' }],
        'T&C Templates': [
          { code: 'TC-03', name: 'Standard Medical Equipment T&C v3', poType: 'Standard', clauses: 'Delivery 45 days; warranty 36M; LD 0.5%/week; performance security 5%', locked: 'Payment terms', version: 'v3', effective: '2025-04-01', status: 'Active' },
          { code: 'TC-07', name: 'High-value Turnkey T&C', poType: 'Turnkey', clauses: 'Site prep + installation + training; CAMC 5Y; uptime 95%', locked: 'Warranty terms', version: 'v1', effective: '2026-01-01', status: 'Active' }],
        'Users & Roles': [
          { code: 'U-001', name: 'Madhuri (Admin)', role: 'Admin', hod: '—', access: 'All modules', active: 'Active', status: 'Active' },
          { code: 'U-002', name: 'Ramesh Kumar', role: 'TGMSIDC User', hod: '—', access: 'Indent verify, RC, PO, Delivery', active: 'Active', status: 'Active' },
          { code: 'U-003', name: 'S. Rao (DEO)', role: 'DEO (HoD)', hod: 'HoD Facility — Directorate', access: 'Indent entry (own facility)', active: 'Active', status: 'Active' },
          { code: 'U-004', name: 'ABC Vendor Admin', role: 'Vendor Portal', hod: '—', access: 'Portal: PO ack, dispatch, DCC', active: 'Active', status: 'Active' }]
      },
      masters: { Equipment: 1842, Institutions: 426, Vendors: 318, 'Account Heads': 64, Programmes: 28, 'Funding Sources': 18, 'Users & Roles': 156, 'Tax / GST Slabs': 12 },
      /* Vendor portal */
      grievances: [
        { id: 'GRV-101', vendor: 'MedEquip India', po: 'PO/2026/00449', subject: 'Payment delayed 45 days', status: 'Open' },
        { id: 'GRV-098', vendor: 'ABC Medical Systems', po: 'PO/2026/00452', subject: 'Consignee unavailability for installation', status: 'Resolved' }
      ],
      vendorPerf: [{ vendor: 'ABC Medical Systems', onTime: 92, qa: 96, rating: 4.6 }, { vendor: 'XYZ Healthcare', onTime: 84, qa: 91, rating: 4.2 }, { vendor: 'MedEquip India', onTime: 76, qa: 88, rating: 3.9 }],
      audit: [
        { dt: '05-Oct-2026 10:42', user: 'Ramesh Kumar (TGMSIDC)', module: 'Indent Approval', action: 'Verified', ref: 'IND-2026-00124', source: 'Web Portal' },
        { dt: '05-Oct-2026 10:25', user: 'Anita Rao (SO)', module: 'Purchase Order', action: 'Approved', ref: 'PO/2026/00452', source: 'Web Portal' },
        { dt: '05-Oct-2026 09:58', user: 'Vendor Admin', module: 'Delivery', action: 'Document Upload', ref: 'PO/2026/00452', source: 'Vendor Portal' }
      ],
      notifications: [
        { t: 'RC/2026/002 expires in 22 days — initiate renewal', age: '10m', urgent: true },
        { t: '18 indents pending TGMSIDC verification', age: '32m', urgent: true },
        { t: 'PO/2026/00452 approved by ED', age: '1h', urgent: false }
      ]
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // Validate shape — reseed on corrupt/partial stores (prevents frozen UI)
        if (parsed && Array.isArray(parsed.indents) && Array.isArray(parsed.rcs) && Array.isArray(parsed.pos)) return parsed;
      }
    } catch (e) {}
    const fresh = seed();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh)); } catch (e) {}
    return fresh;
  }
  function save(db) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); } catch (e) {} }
  function reset() { const fresh = seed(); save(fresh); return fresh; }

  const db = load();
  // Backward-compat: v3 stores lack qas[] (had qa{}) — migrate
  if (db.qa && !db.qas) { db.qas = [{ po: db.qa.po || 'PO/2026/00452', equipment: db.qa.equipment || 'Ventilator', qty: db.qa.qty || 15, vendor: db.qa.vendor || 'ABC Medical Systems', stage: 'Inspection', committee: ['Dr. Rao (Chair)', 'Biomedical Eng. Kumar'], checklist: db.qa.checklist || [true, true, true, true, false, false], installDone: false, trainingDone: false, payment: db.qa.payment || 'Not-Paid', warrantyStart: db.qa.warrantyStart || '', warrantyPeriod: db.qa.warrantyPeriod || '36 Months', inspectionDate: db.qa.inspectionDate || '05-Oct-2026', decision: '', history: [] }]; }
  if (!db.masterRecords) db.masterRecords = seed().masterRecords;
  if (!db.grievances) db.grievances = seed().grievances;
  if (!db.vendorPerf) db.vendorPerf = seed().vendorPerf;

  const LATENCY = () => 350 + Math.random() * 350;
  const clone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));
  function delayResolve(val) { return new Promise((res, rej) => setTimeout(() => { try { res(clone(val)); } catch (e) { rej(e); } }, LATENCY())); }

  global.DEMS_DB = { data: db, save: () => save(db), reset };
  global.MockAPI = {
    getIndents: (f = {}) => { let rows = [...db.indents]; if (f.q) rows = rows.filter((r) => (r.id + r.facility).toLowerCase().includes(f.q.toLowerCase())); if (f.status && f.status !== 'All') rows = rows.filter((r) => r.status === f.status); return delayResolve(rows); },
    getRCs: (f = {}) => { let rows = [...db.rcs]; if (f.q) rows = rows.filter((r) => (r.no + r.vendor + r.equipment).toLowerCase().includes(f.q.toLowerCase())); if (f.status && f.status !== 'All') rows = rows.filter((r) => r.status === f.status); return delayResolve(rows); },
    getPOs: () => delayResolve([...db.pos]),
    getDeliveries: () => delayResolve([...db.deliveries]),
    getAudit: () => delayResolve([...db.audit].reverse()),
    getDashboard: () => delayResolve({ kpis: { indents: 1248 + db.indents.length, pending: 186, activeRC: db.rcs.filter((r) => r.status === 'Active').length + 82, poCr: 48.62 }, pipeline: [1248, 1172, 894, 327, 216, 174], expiring: db.rcs.filter((r) => r.status !== 'Active').length, activity: [...db.audit].slice(-3).reverse() })
  };
})(window);
