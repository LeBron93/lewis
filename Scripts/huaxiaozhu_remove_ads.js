if (!$response.body) $done({});
let obj = JSON.parse($response.body);

//导航栏
if (url.inclubes("/gulfstream/passenger-center/v1/other/pData")) {
  if (obj.data && Array.isArray(obj.data.components)) {
    obj.data.components.forEach(component => {
      if (component.data && Array.isArray(component.data.king_kong_position_list)) {
        // Filter out specific titles
        component.data.king_kong_position_list = component.data.king_kong_position_list.filter(item => {
          return !["省钱套餐", "得5折券", "赚现金", "花花会员", "花花学生惠", "邀人享免单", "88元券包", "省钱中心", "借钱"].includes(item.title);
        });
  
        // Set bubble_text fields to an empty string
        component.data.king_kong_position_list.forEach(item => {
          if (item.bubble_text !== undefined) {
            item.bubble_text = '';
          }
        });
      }
  
      // Filter out specific names in template
      if (component.template && component.template.name) {
        const namesToRemove = ["weather", "running_order", "destination_recommend_dest-normal_template", "activity_cover_layer", "register_driver-normal", "new_marketing_bubble-normal_template", "new_user_skin_v2", "emotion_card_king_flower_sfc"];
        if (namesToRemove.includes(component.template.name)) {
          delete component.template.name;
        }
      }
    });
  }
}

//资源列表
else if (url.inclubes("/ulfstream/passenger-center/v1/other/pLayout")) {
      // Filter `lazy_load_components` to keep only 'resource_position_list'
  obj.data.page_conf.lazy_load_components = obj.data.page_conf.lazy_load_components.filter(component => component === "resource_position_list");

  // Filter `disorder_components` to keep only the one with `name` 'resource_position_list'
  obj.data.disorder_components = obj.data.disorder_components.filter(component => component.name === "resource_position_list");
}

//侧边栏
else if (url.inclubes("/usercenter/kflowermenu")) {
  if (obj.data && obj.data.driver_activity) {
    delete obj.data.driver_activity;
  }
  
  if (obj.data && obj.data.tools && obj.data.tools.item) {
    obj.data.tools.item = obj.data.tools.item.filter(tool => 
      tool.name !== "借钱" && tool.name !== "学生福利"
    );
  }
  
  if (obj.data && obj.data.dynamic_menus) {
    obj.data.dynamic_menus = obj.data.dynamic_menus.filter(menu => 
      menu.title !== "借钱" && menu.title !== "学生福利"
    );
  }
  
  if (obj.data && obj.data.payment && obj.data.payment.title === "开通免密支付") {
    delete obj.data.payment;
  }
}

//支付界面套餐推荐
else if (url.inclubes("/gulfstream/pay/v1/client/getPayInfo"|"/gulfstream/pay/v1/client/changePayInfo")) {
  if (obj.data) {
    // Clear the goods_list entry
    if (obj.data.goods_list) {
      obj.data.goods_list = [];
    }
  
    if (obj.data.bill_detail && Array.isArray(obj.data.bill_detail.external_channel_list)) {
      
     //obj.data.bill_detail.external_channel_list = obj.data.bill_detail.external_channel_list.filter(channel => channel.name !== "花小猪付");// 删除花小猪付
      obj.data.bill_detail.external_channel_list.forEach(channel => {
        if (channel.sign_guide) {
          delete channel.sign_guide.tips;
        }
      });
    }
  }
}

//打车界面
else if (url.inclubes("/gulfstream/passenger/v2/core/pMultiEstimatePrice")) {
  if (obj.data && obj.data.cp_list) {
    obj.data.cp_list.forEach(cp => {
      if (cp.car_list) {
        cp.car_list.forEach(car => {
          // Remove specific fields from each car
          delete car.suggest_tag;
          delete car.special_price_detail;
          delete car.brand_desc;
        });
      }
  
      // Process fold_cars section
      if (cp.fold_cars && cp.fold_cars.car_list) {
        cp.fold_cars.car_list.forEach(car => {
          delete car.suggest_tag;
          delete car.special_price_detail;
          delete car.brand_desc;
        });
      }
    });
  }
  
  // Set the sub_title field to an empty string
  if (obj.data && obj.data.package_data && typeof obj.data.package_data.sub_title !== 'undefined') {
    obj.data.package_data.sub_title = '';
  }
  
  // Remove the new_user_skin field
  if (obj.data && obj.data.package_data && obj.data.package_data.new_user_skin) {
    delete obj.data.package_data.new_user_skin;
  }
}

$done({ body: JSON.stringify(obj) });