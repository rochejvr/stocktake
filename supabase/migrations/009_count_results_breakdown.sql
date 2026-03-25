-- Break down counts into direct scans vs WIP/chain credits
ALTER TABLE count_results ADD COLUMN count1_direct_qty numeric;
ALTER TABLE count_results ADD COLUMN count1_wip_qty numeric;
ALTER TABLE count_results ADD COLUMN count2_direct_qty numeric;
ALTER TABLE count_results ADD COLUMN count2_wip_qty numeric;
