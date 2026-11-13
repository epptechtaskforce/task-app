/* demo-data.js - everything the demo needs to look like a company that has used the app for two months:
 * people, tasks, worker updates, sample photos (drawn here, no image files), sample documents and a voice sample.
 * Used only by demo mode (demo.js). All names, numbers and pictures are invented. */
(function (w) {
  'use strict';

  /* ============================== people ============================== */
  const TITLES = [['Chairman', 1], ['General Manager', 2], ['Supervisor', 3], ['Field Officer', 4]];
  // [username, name, job title, short bio]
  const PEOPLE = [
    ['nimal.perera', 'Nimal Perera', 'Chairman', 'Chairman. Ask me about strategy and budgets.'],
    ['kamala.silva', 'Kamala Silva', 'General Manager', 'General Manager, Operations. Keeps the harvest and packing schedules running.'],
    ['dinesh.rathnayake', 'Dinesh Rathnayake', 'General Manager', 'General Manager, Packing and Logistics. Cold chain and dispatch.'],
    ['sunil.fernando', 'Sunil Fernando', 'Supervisor', 'Supervisor of the field teams. Irrigation and quality checks.'],
    ['nadeesha.wickrama', 'Nadeesha Wickrama', 'Supervisor', 'Quality supervisor. Lab samples, grading and audits.'],
    ['ruwan.jayasinghe', 'Ruwan Jayasinghe', 'Field Officer', 'Field officer, Blocks A to C.'],
    ['ishara.dias', 'Ishara Dias', 'Field Officer', 'Field officer. Ask me about drip lines.'],
    ['kasun.bandara', 'Kasun Bandara', 'Field Officer', 'Field officer, Blocks D and E. Fences, equipment, seedlings.'],
    ['thilini.herath', 'Thilini Herath', 'Field Officer', 'Packing house and stock records.'],
    ['mahesh.kumara', 'Mahesh Kumara', 'Field Officer', 'Dispatch and cold room.']
  ];
  const SHORT = { nimal: 'nimal.perera', kamala: 'kamala.silva', dinesh: 'dinesh.rathnayake', sunil: 'sunil.fernando', nadeesha: 'nadeesha.wickrama', ruwan: 'ruwan.jayasinghe', ishara: 'ishara.dias', kasun: 'kasun.bandara', thilini: 'thilini.herath', mahesh: 'mahesh.kumara' };
  // who may give tasks to whom (the "tether" arrows of the org chart)
  const ARROWS = {
    nimal: ['kamala', 'dinesh', 'sunil', 'nadeesha'],
    kamala: ['sunil', 'nadeesha', 'ruwan', 'ishara', 'kasun'],
    dinesh: ['nadeesha', 'thilini', 'mahesh'],
    sunil: ['ruwan', 'ishara', 'kasun', 'mahesh'],
    nadeesha: ['thilini', 'mahesh', 'kasun', 'ruwan']
  };

  /* ============================== tasks ============================== */
  // Event rows (day = days ago, hour = hour of that day, who = short name):
  //  ['s', day, hour, who, text]        a typed update            ['v', day, hour, who, seconds, what was said]   a voice message
  //  ['i', day, hour, who, kind, text]  a photo with a caption    ['f', day, hour, who, docKey, text]  a document
  //  ['p', day, hour, who, percent]     progress slider           ['ok', day, hour]   the manager approves (archives it)
  //  ['back', day, hour, note]          the manager sends it back
  // Task: t title, d details, by manager, to people, day/hour created, due = days from today (negative = already late)
  const TASKS = [
    /* ---------- finished and archived (History) ---------- */
    { t: 'Harvest totals report for September', d: 'Collect picking totals for every block and send me one summary before the Friday review.', by: 'kamala', to: ['sunil', 'ruwan'], day: 58, hour: 9, due: -53, ev: [
      ['s', 58, 10, 'kamala', 'Please have this ready before the Friday review.'], ['s', 57, 15, 'sunil', 'Blocks A and B are counted. Waiting for the C totals.'],
      ['v', 56, 11, 'ruwan', 14, 'Block C counting is finished. The total picked in Block C was 3975 kilos and 201 kilos were rejected.'], ['f', 56, 16, 'ruwan', 'totals-csv', 'Block totals as a sheet'], ['p', 55, 9, 'sunil', 100], ['ok', 55, 14]] },
    { t: 'Replace blocked drippers in Block B', d: 'Walk rows 1 to 14, replace every blocked emitter and note how many were changed.', by: 'sunil', to: ['ruwan', 'ishara'], day: 56, hour: 8, due: -52, ev: [
      ['s', 56, 12, 'ruwan', 'Started at row 1. Many emitters are clogged with algae.'], ['i', 55, 10, 'ishara', 'drip', 'Row 4 with the new emitters fitted'], ['p', 55, 15, 'ruwan', 50],
      ['s', 54, 11, 'ishara', 'Rows 8 to 14 done. 63 emitters replaced in total.'], ['p', 54, 12, 'ishara', 100], ['ok', 54, 16]] },
    { t: 'Set up the packing line for export order 118', d: 'Line 2 must be ready with labels, punnets and the metal detector tested.', by: 'dinesh', to: ['thilini', 'mahesh'], day: 54, hour: 9, due: -50, ev: [
      ['s', 54, 14, 'thilini', 'Labels and punnets are in. Metal detector test is booked for tomorrow.'], ['i', 53, 11, 'mahesh', 'crates', 'Line 2 stacked and ready'],
      ['f', 53, 15, 'thilini', 'packing-pdf', 'Packing plan for the order'], ['p', 52, 10, 'thilini', 100], ['ok', 52, 15]] },
    { t: 'Calibrate the Brix meter and log the readings', d: 'Use the reference solution and record three readings per batch for two weeks.', by: 'nadeesha', to: ['kasun'], day: 52, hour: 10, due: -40, ev: [
      ['s', 52, 15, 'kasun', 'Calibrated with the reference solution. Reading is within 0.1.'], ['i', 45, 11, 'kasun', 'chart', 'Two weeks of readings'], ['p', 39, 10, 'kasun', 100], ['ok', 38, 14]] },
    { t: 'Prepare the board update on export growth', d: 'One page with the volumes, the new buyers and what we need from the board.', by: 'nimal', to: ['kamala'], day: 50, hour: 9, due: -43, ev: [
      ['s', 49, 11, 'kamala', 'First draft is with Dinesh for the logistics numbers.'], ['f', 46, 16, 'kamala', 'board-pdf', 'Final one-pager'], ['p', 45, 9, 'kamala', 100], ['ok', 45, 13]] },
    { t: 'Pest scouting in Blocks A to D', d: 'Check 20 plants per block for mites and aphids and photograph anything suspicious.', by: 'kamala', to: ['ruwan', 'ishara', 'kasun'], day: 47, hour: 8, due: -43, ev: [
      ['i', 46, 10, 'ruwan', 'field', 'Block A, leaves look clean'], ['s', 46, 13, 'ishara', 'Block C has light mite damage on the lower leaves.'], ['v', 45, 9, 'kasun', 21, 'Block D looks clean, no mites. I checked twenty plants near the gate and found only a few aphids on two plants.'],
      ['i', 45, 12, 'ishara', 'field', 'Block C damage, close to the south fence'], ['s', 45, 16, 'kamala', 'Thanks. Sunil will spray Block C on Monday.'], ['p', 44, 10, 'ruwan', 100], ['ok', 44, 15]] },
    { t: 'Service the cold room compressor', d: 'Book the technician, keep the room below 4 degrees while the work is done.', by: 'dinesh', to: ['mahesh'], day: 45, hour: 9, due: -42, ev: [
      ['s', 45, 14, 'mahesh', 'Technician comes Thursday morning. I will move the stock to room 1.'], ['i', 43, 12, 'mahesh', 'cold', 'Room back to 2.4 degrees after the service'], ['p', 43, 13, 'mahesh', 100], ['ok', 43, 16]] },
    { t: 'Fix the fence near the Block D gate', d: 'Wild boar broke the lower wire. Repair and add two more posts.', by: 'sunil', to: ['kasun'], day: 43, hour: 8, due: -40, ev: [
      ['s', 42, 10, 'kasun', 'Posts are on site. Starting the repair.'], ['i', 41, 14, 'kasun', 'field', 'Fence repaired, two new posts'], ['p', 41, 15, 'kasun', 100], ['ok', 41, 17]] },
    { t: 'Truck slots for the October dispatch', d: 'Match the truck slots with the harvest forecast and share the schedule with the packing house.', by: 'kamala', to: ['sunil'], day: 40, hour: 9, due: -36, ev: [
      ['s', 39, 11, 'sunil', 'Draft schedule is ready, checking it against the forecast.'], ['f', 38, 15, 'sunil', 'trucks-pdf', 'Truck schedule for October'], ['p', 38, 16, 'sunil', 100], ['ok', 37, 9]] },
    { t: 'Weekly quality sampling, three batches', d: 'Take samples from three batches, record firmness and sugar, and report any batch below grade.', by: 'nadeesha', to: ['thilini', 'mahesh'], day: 38, hour: 9, due: -33, ev: [
      ['s', 37, 12, 'thilini', 'Batch 1 and 2 are fine. Batch 3 firmness is slightly low.'], ['i', 36, 11, 'mahesh', 'chart', 'Firmness and sugar results'], ['p', 35, 10, 'thilini', 100], ['ok', 35, 14]] },
    { t: 'Review the packaging supplier quotes', d: 'Compare the three quotes on price, delivery time and minimum order.', by: 'nimal', to: ['dinesh'], day: 35, hour: 10, due: -28, ev: [
      ['s', 34, 14, 'dinesh', 'Supplier B is cheapest but needs 6 weeks. Supplier A delivers in 2 weeks.'], ['f', 31, 11, 'dinesh', 'quotes-pdf', 'Comparison of the three quotes'], ['s', 31, 12, 'nimal', 'Go with A for the next two orders.'], ['p', 30, 9, 'dinesh', 100], ['ok', 30, 12]] },
    { t: 'Fertiliser application in Blocks A to C', d: 'Apply the planned mix, record the quantity used per block.', by: 'sunil', to: ['ruwan', 'ishara'], day: 32, hour: 7, due: -28, ev: [
      ['v', 31, 10, 'ruwan', 18, 'I started the fertiliser in Block A this morning. The mixer is working fine and we will finish A and B today.'], ['i', 30, 11, 'ishara', 'field', 'Block B after the application'], ['s', 30, 15, 'ruwan', 'A and B are done. 240 kg used in A, 210 kg in B.'], ['p', 29, 10, 'ruwan', 100], ['ok', 29, 13]] },
    { t: 'Safety drill and extinguisher check', d: 'Run the fire drill with the packing house staff and check every extinguisher tag.', by: 'kamala', to: ['nadeesha'], day: 28, hour: 9, due: -24, ev: [
      ['s', 27, 11, 'nadeesha', 'Drill planned for Wednesday 10 am.'], ['i', 25, 14, 'nadeesha', 'extinguisher', 'All tags updated, two extinguishers replaced'], ['p', 25, 15, 'nadeesha', 100], ['ok', 25, 17]] },
    { t: 'Update the cold chain temperature log', d: 'The log has gaps for the last two weeks. Fill them from the data logger.', by: 'dinesh', to: ['thilini'], day: 25, hour: 10, due: -22, ev: [
      ['s', 24, 12, 'thilini', 'Downloaded the data logger file, entering it now.'], ['i', 23, 11, 'thilini', 'sheet', 'Updated log, no gaps left'], ['p', 23, 12, 'thilini', 100], ['ok', 23, 15]] },
    { t: 'Clear the weeds along the irrigation canal', d: 'Both sides of the main canal, from the pump house to Block E.', by: 'sunil', to: ['ishara', 'kasun'], day: 21, hour: 8, due: -16, ev: [
      ['s', 20, 12, 'kasun', 'Started from the pump house side with the two helpers.'], ['i', 18, 11, 'ishara', 'leak', 'Canal bank after clearing'], ['p', 17, 10, 'ishara', 100], ['ok', 17, 14]] },
    { t: 'Count and label the new picking crates', d: 'About 400 new crates. Number them and record them in the stock sheet.', by: 'kamala', to: ['ruwan'], day: 17, hour: 9, due: -13, ev: [
      ['s', 16, 13, 'ruwan', 'Counted 412 crates. Labelling now.'], ['i', 14, 10, 'ruwan', 'crates', 'Labelled stack, ready for the blocks'], ['p', 14, 11, 'ruwan', 100], ['ok', 14, 15]] },
    { t: 'Retrain the pickers on ripeness grading', d: 'Short session with the picture cards for every picking team.', by: 'nadeesha', to: ['kasun', 'mahesh'], day: 13, hour: 9, due: -9, ev: [
      ['v', 12, 10, 'kasun', 24, 'We finished the grading session with teams one and two. The picture cards help a lot and the pickers now understand the colours.'], ['i', 11, 12, 'mahesh', 'field', 'Team 3 with the grading cards'], ['s', 11, 15, 'kasun', 'All five teams are done. Rejects dropped the next day.'], ['p', 10, 10, 'kasun', 100], ['ok', 10, 14]] },
    { t: 'Approve the Q4 harvest forecast', d: 'Check the forecast sheet and confirm the numbers for the buyers.', by: 'nimal', to: ['kamala'], day: 9, hour: 10, due: -5, ev: [
      ['s', 8, 11, 'kamala', 'Forecast is 12 percent above last year. Details in the sheet.'], ['f', 7, 15, 'kamala', 'forecast-csv', 'Q4 forecast by block'], ['p', 6, 9, 'kamala', 100], ['ok', 5, 11]] },
    { t: 'Dispatch checklist for the Colombo order', d: 'Check labels, temperature, seals and paperwork before the truck leaves.', by: 'dinesh', to: ['mahesh'], day: 6, hour: 9, due: -3, ev: [
      ['s', 5, 12, 'mahesh', 'Labels and seals checked. Truck arrives at 4 pm.'], ['i', 4, 17, 'mahesh', 'truck', 'Truck loaded and sealed'], ['p', 3, 9, 'mahesh', 100], ['ok', 3, 12]] },

    /* ---------- finished, waiting for the manager to approve ---------- */
    { t: 'Prepare the packing schedule for Friday', d: 'Match the truck slots with the harvest forecast.', by: 'kamala', to: ['sunil', 'ruwan'], day: 4, hour: 9, due: 0, ev: [
      ['s', 3, 11, 'sunil', 'Drafted and shared with the packing house.'], ['i', 2, 14, 'ruwan', 'crates', 'Crate stacks for the first truck'], ['p', 0, 8, 'sunil', 100]] },
    { t: 'Monthly lab results summary', d: 'Summarise the pesticide residue and sugar results from the lab for the file.', by: 'nadeesha', to: ['thilini'], day: 3, hour: 10, due: 1, unread: true, ev: [
      ['s', 2, 12, 'thilini', 'All residue results are well under the limit.'], ['f', 1, 15, 'thilini', 'lab-pdf', 'Lab summary for this month'], ['p', 1, 16, 'thilini', 100]] },

    /* ---------- in progress ---------- */
    { t: 'Check irrigation in Block C', d: 'Walk the lines and report any leaks or blocked drippers.', by: 'kamala', to: ['ruwan', 'ishara'], day: 6, hour: 9, due: 2, ev: [
      ['v', 5, 10, 'ruwan', 14, 'I walked rows one to ten in Block C. The water pressure is good. I will check the rest of the rows this afternoon.'], ['s', 5, 14, 'ishara', 'Rows 1 to 10 are fine. Two drippers blocked in row 11, fixing now.'], ['i', 3, 11, 'ruwan', 'leak', 'Leak at the joint near row 12'],
      ['s', 3, 15, 'kamala', 'Please fix the joint first, it wastes the most water.'], ['p', 2, 10, 'ishara', 60]] },
    { t: 'Transplant new seedlings in Block E', d: 'About 3,000 seedlings. Keep 40 cm between plants.', by: 'sunil', to: ['kasun', 'mahesh'], day: 5, hour: 8, due: 5, ev: [
      ['s', 4, 11, 'kasun', 'First 1,200 are in. Soil is moist enough.'], ['i', 3, 12, 'mahesh', 'field', 'New rows in Block E, day 2'], ['v', 1, 10, 'kasun', 17, 'We planted another eight hundred seedlings in Block E. The soil is moist and the seedlings look healthy.'], ['p', 1, 11, 'kasun', 40]] },
    { t: 'Install the shelving in cold room 2', d: 'Six racks, anchored to the floor, and move the stock back.', by: 'dinesh', to: ['thilini', 'mahesh'], day: 4, hour: 9, due: 6, ev: [
      ['s', 3, 12, 'mahesh', 'Racks delivered. Two are missing the corner brackets.'], ['s', 3, 14, 'dinesh', 'Ask the supplier to send them tomorrow.'], ['i', 1, 13, 'thilini', 'cold', 'Room 2 with the first racks in place'], ['p', 1, 14, 'mahesh', 25]] },
    { t: 'Draft the next season expansion plan', d: 'Land, water, labour and the investment needed for 10 more acres.', by: 'nimal', to: ['kamala'], day: 3, hour: 10, due: 10, ev: [
      ['s', 2, 11, 'kamala', 'I have the land and water numbers. Labour costs are next.'], ['f', 1, 16, 'kamala', 'plan-pdf', 'First draft of the plan'], ['p', 1, 17, 'kamala', 30]] },
    { t: 'Send soil samples to the lab', d: 'Five samples from different blocks, labelled, with the request form.', by: 'nadeesha', to: ['ruwan'], day: 2, hour: 9, due: 4, ev: [
      ['i', 1, 10, 'ruwan', 'drip', 'Taking the sample next to the drip line in Block B'], ['s', 1, 13, 'ruwan', 'Three samples collected, two more tomorrow.'], ['p', 1, 14, 'ruwan', 50]] },
    { t: 'Prepare the supplier audit documents', d: 'Collect certificates, spray records and training logs for the audit.', by: 'kamala', to: ['sunil', 'nadeesha'], day: 1, hour: 11, due: 7, unread: true, ev: [
      ['s', 1, 15, 'nadeesha', 'I have the training logs. The spray records are with Sunil.'], ['f', 0, 9, 'sunil', 'audit-pdf', 'Spray record list so far'], ['p', 0, 10, 'sunil', 20]] },

    /* ---------- overdue ---------- */
    { t: 'Repair the pump house roof', d: 'The roof leaks over the electric panel. Repair before the rains get heavier.', by: 'kamala', to: ['ishara'], day: 21, hour: 9, due: -9, ev: [
      ['s', 20, 12, 'ishara', 'Checked the roof. We need sheets and screws from the hardware shop.'], ['s', 17, 10, 'kamala', 'Did the materials arrive?'], ['s', 17, 14, 'ishara', 'Not yet, the shop says Monday.'],
      ['i', 12, 11, 'ishara', 'leak', 'Water marks next to the panel after last night rain'], ['p', 12, 12, 'ishara', 35], ['s', 8, 9, 'kamala', 'This is now late. Please tell me what you need to finish.']] },
    { t: 'Weekly equipment inspection report', d: 'Check sprayers, pumps and the tractor and report anything that needs repair.', by: 'sunil', to: ['kasun', 'mahesh'], day: 18, hour: 8, due: -6, ev: [
      ['v', 17, 11, 'kasun', 19, 'I checked the sprayers and the water pumps. Sprayer two has a worn seal and pump three is making a noise. I have not checked the tractor yet.'], ['s', 15, 14, 'mahesh', 'Sprayer 2 has a worn seal. Ordered a spare.'], ['p', 14, 10, 'kasun', 70], ['s', 7, 10, 'sunil', 'Report still missing the tractor and the pumps.']] },
    { t: 'Reconcile the packaging material stock', d: 'Count punnets, labels and cartons and match them to the stock sheet.', by: 'dinesh', to: ['thilini'], day: 15, hour: 10, due: -4, ev: [
      ['s', 14, 12, 'thilini', 'Counting punnets today, labels tomorrow.'], ['f', 11, 15, 'thilini', 'stock-csv', 'Stock count so far'], ['p', 10, 16, 'thilini', 55], ['s', 5, 11, 'dinesh', 'Two cartons sizes are still missing from the count.']] },
    { t: 'Submit the compliance checklist to the exporter', d: 'Complete every section, attach the certificates and submit through the exporter portal.', by: 'nimal', to: ['kamala', 'dinesh'], day: 12, hour: 9, due: -2, ev: [
      ['s', 11, 12, 'dinesh', 'Logistics sections are complete. Waiting for the farm sections.'], ['f', 7, 14, 'kamala', 'compliance-pdf', 'Farm sections as a draft'], ['p', 6, 15, 'kamala', 80], ['s', 3, 9, 'nimal', 'The exporter called. We must submit by this week.']] },

    /* ---------- sent back once, now being reworked ---------- */
    { t: 'Mark the irrigation valves on the site map', d: 'Every valve numbered on the printed site map, so night staff can find them.', by: 'kamala', to: ['ruwan'], day: 10, hour: 9, due: 1, ev: [
      ['s', 9, 12, 'ruwan', 'Marked the valves in A and B.'], ['p', 7, 11, 'ruwan', 100], ['back', 7, 15, 'Blocks C and D are missing, and valve 14 is in the wrong place.'], ['s', 6, 10, 'ruwan', 'Understood, going to C and D tomorrow.'],
      ['i', 3, 12, 'ruwan', 'sheet', 'Updated map with C and D'], ['p', 3, 13, 'ruwan', 70]] },

    /* ---------- just assigned ---------- */
    { t: 'Send the Q4 budget draft', d: '', by: 'nimal', to: ['kamala'], day: 0, hour: 8, due: 2, unread: true, ev: [] },
    { t: 'Plan the weekend harvest shifts', d: 'Two shifts on Saturday, one on Sunday. Check who can work.', by: 'kamala', to: ['sunil', 'ruwan'], day: 0, hour: 9, due: 1, unread: true, ev: [] },
    { t: 'Arrange transport for the Sunday dispatch', d: 'Confirm the truck, the driver and the loading time with the packing house.', by: 'dinesh', to: ['mahesh'], day: 1, hour: 16, due: 1, unread: true, ev: [
      ['s', 0, 8, 'mahesh', 'I called the transporter. Will confirm the time this afternoon.']] }
  ];

  /* ============================== sample pictures (drawn here) ============================== */
  let seedN = 7;
  function rand() { seedN = (seedN * 1664525 + 1013904223) % 4294967296; return seedN / 4294967296; }
  function lin(g, x0, y0, x1, y1, a, b) { const k = g.createLinearGradient(x0, y0, x1, y1); k.addColorStop(0, a); k.addColorStop(1, b); return k; }
  function rr(g, x, y, wd, ht, r, fill) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + wd, y, x + wd, y + ht, r); g.arcTo(x + wd, y + ht, x, y + ht, r); g.arcTo(x, y + ht, x, y, r); g.arcTo(x, y, x + wd, y, r); g.closePath(); g.fillStyle = fill; g.fill(); }
  function dot(g, x, y, r, fill) { g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fillStyle = fill; g.fill(); }
  function sky(g, W, H, hz) { g.fillStyle = lin(g, 0, 0, 0, hz, '#8cc8f5', '#eaf6ff'); g.fillRect(0, 0, W, hz); dot(g, W * 0.82, H * 0.14, 34, '#fff3b0'); }
  function text(g, s, x, y, size, color, align, weight) { g.font = (weight || '700') + ' ' + size + 'px system-ui, sans-serif'; g.fillStyle = color; g.textAlign = align || 'left'; g.fillText(s, x, y); }

  const PAINT = {
    field: function (g, W, H) {
      const hz = H * 0.4; sky(g, W, H, hz);
      g.fillStyle = '#7fb069'; g.beginPath(); g.moveTo(0, hz); for (let x = 0; x <= W; x += 40) g.lineTo(x, hz - 18 - 14 * Math.sin(x / 90)); g.lineTo(W, hz); g.fill();
      g.fillStyle = lin(g, 0, hz, 0, H, '#6b4a2f', '#4a3220'); g.fillRect(0, hz, W, H - hz);
      for (let i = -5; i <= 5; i++) {
        const vx = W / 2, bx = W / 2 + i * W * 0.2;
        g.beginPath(); g.moveTo(vx + i * 4, hz); g.lineTo(bx - W * 0.06, H); g.lineTo(bx + W * 0.06, H); g.lineTo(vx + i * 4 + 4, hz); g.closePath(); g.fillStyle = '#2f7d32'; g.fill();
        for (let k = 0; k < 46; k++) { const t = 0.08 + rand() * 0.92, x = vx + i * 4 + (bx - vx - i * 4) * t + (rand() - 0.5) * W * 0.08 * t, y = hz + (H - hz) * t; dot(g, x, y, 1.5 + 6 * t, rand() < 0.7 ? '#c2185b' : '#3b3bb5'); }
      }
    },
    leak: function (g, W, H) {
      g.fillStyle = lin(g, 0, 0, 0, H, '#7a5a3a', '#3e2a1a'); g.fillRect(0, 0, W, H);
      for (let i = 0; i < 90; i++) dot(g, rand() * W, rand() * H, 1 + rand() * 3, 'rgba(0,0,0,.18)');
      rr(g, -20, H * 0.34, W + 40, 64, 12, '#15181c'); rr(g, -20, H * 0.34, W + 40, 14, 8, 'rgba(255,255,255,.12)');
      rr(g, W * 0.46, H * 0.3, 60, 72, 10, '#2b3138'); rr(g, W * 0.48, H * 0.3 - 8, 24, 12, 4, '#9aa5b1');
      g.strokeStyle = 'rgba(120,200,255,.85)'; g.lineWidth = 3; for (let i = 0; i < 16; i++) { g.beginPath(); g.moveTo(W * 0.5 + 8, H * 0.34 + 70); g.quadraticCurveTo(W * 0.5 + (rand() - 0.5) * 140, H * 0.55, W * 0.5 + (rand() - 0.5) * 250, H * 0.78); g.stroke(); }
      g.fillStyle = 'rgba(74,163,223,.75)'; g.beginPath(); g.ellipse(W * 0.5, H * 0.8, W * 0.3, 52, 0, 0, 6.2832); g.fill();
      g.fillStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.ellipse(W * 0.46, H * 0.78, W * 0.1, 12, 0, 0, 6.2832); g.fill();
    },
    drip: function (g, W, H) {
      g.fillStyle = lin(g, 0, 0, 0, H, '#8a6a47', '#4d3622'); g.fillRect(0, 0, W, H);
      for (let i = 0; i < 70; i++) dot(g, rand() * W, rand() * H, 1 + rand() * 2.5, 'rgba(0,0,0,.2)');
      g.strokeStyle = '#111'; g.lineWidth = 9; g.beginPath(); g.moveTo(0, H * 0.62); g.lineTo(W, H * 0.6); g.stroke();
      for (let i = 0; i < 7; i++) {
        const x = 50 + i * (W - 100) / 6, y = H * 0.61;
        g.fillStyle = '#2f9e44'; for (let l = 0; l < 6; l++) { g.beginPath(); g.ellipse(x + (l - 2.5) * 11, y - 55 - Math.abs(l - 2.5) * 6, 11, 38, (l - 2.5) * 0.35, 0, 6.2832); g.fill(); }
        dot(g, x, y + 8, 6, '#4aa3df'); dot(g, x, y + 30, 4, 'rgba(74,163,223,.7)'); g.fillStyle = 'rgba(40,100,160,.35)'; g.beginPath(); g.ellipse(x, y + 52, 26, 8, 0, 0, 6.2832); g.fill();
      }
    },
    crates: function (g, W, H) {
      g.fillStyle = lin(g, 0, 0, 0, H * 0.55, '#d9dde2', '#bcc3cb'); g.fillRect(0, 0, W, H * 0.55); g.fillStyle = lin(g, 0, H * 0.55, 0, H, '#8f959c', '#6c7279'); g.fillRect(0, H * 0.55, W, H * 0.45);
      for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
        const x = 70 + c * 150 + (r % 2) * 40, y = H * 0.82 - r * 110 - (r === 2 ? 4 : 0);
        rr(g, x, y, 136, 100, 8, '#e53935'); rr(g, x + 8, y + 18, 120, 70, 6, '#b71c1c'); rr(g, x + 40, y + 8, 56, 12, 6, '#7f0f0f');
        for (let k = 0; k < 16; k++) dot(g, x + 18 + rand() * 100, y + 6 + rand() * 12, 9, rand() < 0.5 ? '#c2185b' : '#ad1457');
      }
    },
    chart: function (g, W, H) {
      g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); text(g, 'Results by block', 40, 56, 30, '#1c2430');
      g.strokeStyle = '#cfd6df'; g.lineWidth = 1; for (let i = 0; i < 6; i++) { const y = 100 + i * 58; g.beginPath(); g.moveTo(70, y); g.lineTo(W - 40, y); g.stroke(); }
      const cols = ['#8e24aa', '#3949ab', '#00897b', '#f9a825', '#e53935'], vals = [0.82, 0.64, 0.9, 0.48, 0.7];
      vals.forEach(function (v, i) { const x = 100 + i * 120, hh = v * 290; g.fillStyle = cols[i]; rr(g, x, 390 - hh, 74, hh, 6, cols[i]); text(g, 'ABCDE'[i], x + 37, 420, 20, '#586272', 'center'); });
    },
    cold: function (g, W, H) {
      g.fillStyle = '#1b2430'; g.fillRect(0, 0, W, H); rr(g, 90, 80, W - 180, H - 220, 24, '#0d1117');
      text(g, 'COLD ROOM 2', 130, 140, 26, '#7e8a99'); text(g, '2.4', W / 2 - 40, 300, 150, '#3ddc84', 'center', '800'); text(g, '°C', W / 2 + 140, 270, 60, '#3ddc84', 'center');
      g.strokeStyle = '#3ddc84'; g.lineWidth = 3; g.beginPath(); for (let x = 130; x < W - 130; x += 10) g.lineTo(x, 345 + Math.sin(x / 30) * 8 + rand() * 6); g.stroke(); text(g, 'OK  -  set point 3.0', 130, 395, 22, '#7e8a99');
    },
    sheet: function (g, W, H) {
      g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.fillStyle = '#1e7e34'; g.fillRect(0, 0, W, 44); text(g, 'Date', 24, 30, 20, '#fff'); text(g, 'Room', 200, 30, 20, '#fff'); text(g, 'Temp', 340, 30, 20, '#fff'); text(g, 'Checked by', 480, 30, 20, '#fff');
      for (let r = 0; r < 8; r++) { const y = 44 + r * 50; g.fillStyle = r % 2 ? '#f3f6f9' : '#fff'; g.fillRect(0, y, W, 50); text(g, (10 + r) + ' Nov', 24, y + 33, 20, '#1c2430', 'left', '500'); text(g, '2', 200, y + 33, 20, '#1c2430', 'left', '500'); text(g, (2 + rand() * 1.4).toFixed(1) + ' C', 340, y + 33, 20, '#1c2430', 'left', '500'); text(g, ['Mahesh', 'Thilini'][r % 2], 480, y + 33, 20, '#1c2430', 'left', '500'); }
    },
    truck: function (g, W, H) {
      const hz = H * 0.52; sky(g, W, H, hz); g.fillStyle = '#9aa0a6'; g.fillRect(0, hz, W, H - hz); g.fillStyle = '#fff'; for (let x = 0; x < W; x += 90) g.fillRect(x, H * 0.84, 50, 6);
      rr(g, 80, H * 0.3, 380, 190, 10, '#fafafa'); text(g, 'ACME FOODS', 270, H * 0.3 + 108, 38, '#8e24aa', 'center', '800'); rr(g, 460, H * 0.4, 130, 120, 14, '#3949ab'); rr(g, 520, H * 0.43, 56, 48, 6, '#bfe3ff');
      [150, 330, 520].forEach(function (x) { dot(g, x, H * 0.78, 34, '#222'); dot(g, x, H * 0.78, 15, '#9aa0a6'); });
    },
    extinguisher: function (g, W, H) {
      g.fillStyle = lin(g, 0, 0, 0, H, '#e8e1d4', '#cbc3b4'); g.fillRect(0, 0, W, H); rr(g, W / 2 - 60, 120, 120, 280, 40, '#d32f2f'); rr(g, W / 2 - 18, 80, 36, 50, 8, '#222'); rr(g, W / 2 - 60, 190, 120, 90, 6, '#fff3e0');
      text(g, 'FIRE', W / 2, 252, 34, '#d32f2f', 'center', '800'); g.strokeStyle = '#222'; g.lineWidth = 8; g.beginPath(); g.moveTo(W / 2 + 18, 100); g.quadraticCurveTo(W / 2 + 120, 80, W / 2 + 110, 200); g.stroke(); rr(g, W / 2 + 70, 300, 70, 44, 4, '#fff'); text(g, 'CHECKED', W / 2 + 105, 328, 14, '#2e7d32', 'center');
    }
  };

  function paint(kind, label) {
    const W = 720, H = 500, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); (PAINT[kind] || PAINT.field)(g, W, H);
    g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, H - 46, W, 46); text(g, label || '', 18, H - 16, 22, '#fff', 'left', '600'); text(g, 'SAMPLE PHOTO', W - 16, 28, 15, 'rgba(255,255,255,.75)', 'right');
    const t = document.createElement('canvas'); t.width = 128; t.height = 89; t.getContext('2d').drawImage(c, 0, 0, 128, 89);
    let thumb = t.toDataURL('image/jpeg', 0.55); if (thumb.length > 8500) thumb = t.toDataURL('image/jpeg', 0.3);
    return { b64: c.toDataURL('image/jpeg', 0.62).split(',')[1], thumb: thumb, w: W, h: H };
  }

  /* ============================== sample documents ============================== */
  function makePdf(title, lines) {
    const esc = function (s) { return String(s).replace(/[\\()]/g, '\\$&'); };
    let content = 'BT /F1 20 Tf 56 780 Td (' + esc(title) + ') Tj /F1 12 Tf 0 -34 Td 18 TL\n';
    lines.forEach(function (l) { content += '(' + esc(l) + ') Tj T*\n'; }); content += 'ET';
    const objs = ['<</Type/Catalog/Pages 2 0 R>>', '<</Type/Pages/Kids[3 0 R]/Count 1>>', '<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
      '<</Length ' + content.length + '>>\nstream\n' + content + '\nendstream', '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>'];
    let out = '%PDF-1.4\n'; const offs = [];
    objs.forEach(function (o, i) { offs.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
    const xref = out.length; out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
    offs.forEach(function (o) { out += ('0000000000' + o).slice(-10) + ' 00000 n \n'; });
    out += 'trailer\n<</Size ' + (objs.length + 1) + '/Root 1 0 R>>\nstartxref\n' + xref + '\n%%EOF';
    return btoa(out);
  }
  const DOCS = {
    'totals-csv': ['block-totals-september.csv', function () { return btoa('Block,Picked kg,Rejected kg\nA,4820,160\nB,4310,142\nC,3975,201\nD,2210,64\n'); }],
    'forecast-csv': ['q4-harvest-forecast.csv', function () { return btoa('Block,October kg,November kg,December kg\nA,5200,5600,4800\nB,4700,5100,4300\nC,4300,4700,3900\nD,2600,2900,2400\nE,0,1200,2600\n'); }],
    'stock-csv': ['packaging-stock-count.csv', function () { return btoa('Item,Counted,In sheet\nPunnets 250g,18400,18650\nLabels,22100,22100\nCartons small,1320,1500\nCartons large,610,\n'); }],
    'packing-pdf': ['packing-plan-order-118.pdf', function () { return makePdf('Packing plan - export order 118', ['Line 2, two shifts.', 'Punnets 250 g, 12 per carton.', 'Metal detector test before the first pallet.', 'Pallets: 14, cold room 1 until dispatch.']); }],
    'board-pdf': ['export-growth-board-update.pdf', function () { return makePdf('Export growth - board update', ['Volumes up 18 percent on last season.', 'Two new buyers in the Gulf region.', 'Need: approval for a second cold room.']); }],
    'trucks-pdf': ['october-truck-schedule.pdf', function () { return makePdf('October truck schedule', ['Mon, Wed, Fri 4 pm - Colombo.', 'Tue, Thu 6 am - Airport cargo.', 'Extra truck on peak weeks, book 3 days ahead.']); }],
    'quotes-pdf': ['packaging-quotes-comparison.pdf', function () { return makePdf('Packaging quotes', ['Supplier A: delivery 2 weeks, minimum 5,000.', 'Supplier B: cheapest, delivery 6 weeks.', 'Supplier C: highest price, same-week delivery.']); }],
    'lab-pdf': ['lab-results-summary.pdf', function () { return makePdf('Lab results summary', ['Residue tests: all below the limit.', 'Sugar (Brix): 11.2 to 12.8.', 'Next samples due in 4 weeks.']); }],
    'plan-pdf': ['expansion-plan-draft.pdf', function () { return makePdf('Expansion plan - draft 1', ['10 acres next to Block E.', 'Water: second borehole needed.', 'Labour: 12 more pickers in season.']); }],
    'audit-pdf': ['spray-records-list.pdf', function () { return makePdf('Spray records', ['Blocks A to D, last 90 days.', 'Products and dates listed.', 'Missing: Block E, to be added.']); }],
    'compliance-pdf': ['compliance-checklist-draft.pdf', function () { return makePdf('Exporter compliance checklist', ['Section 1 - Farm: complete.', 'Section 2 - Packing: complete.', 'Section 3 - Traceability: draft.']); }]
  };

  // a soft three-second "voice-like" sample so the voice messages can be played (the demo has no real recordings)
  function voiceWavB64() {
    const rate = 16000, n = rate * 3, bytes = new Uint8Array(44 + n * 2), v = new DataView(bytes.buffer);
    const str = function (o, s) { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
      const t = i / rate, f0 = 130 + 25 * Math.sin(t * 2.3), syl = Math.pow(Math.abs(Math.sin(t * 9.4)), 0.7) * (Math.sin(t * 1.7) > -0.8 ? 1 : 0.1);
      const s = (Math.sin(6.2832 * f0 * t) + 0.5 * Math.sin(6.2832 * 2 * f0 * t) + 0.35 * Math.sin(6.2832 * 3 * f0 * t)) * 0.07 * syl;
      v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 32767, true);
    }
    let bin = ''; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  w.DemoData = {
    titles: TITLES, people: PEOPLE, short: SHORT, arrows: ARROWS, tasks: TASKS,
    image: paint, voice: voiceWavB64,
    doc: function (key) { const d = DOCS[key]; return { name: d[0], b64: d[1]() }; }
  };
})(window);
