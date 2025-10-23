import React, { useState, useEffect } from 'react';

interface ShippingCalendarSelectorProps {
  onSelectShippingOption: (option: any) => void;
  onSelectDeliveryDate: (date: Date) => void;
  onSelectActualDeliveryDate: (date: Date) => void;
  selectedShippingOption: any;
  currentConsignment: any;
  product: any;
  selectedShippingDate: Date | null;
  selectedDeliveryDate: Date | null;
  isLoading: boolean;
  onAutoSubmit: (option: any, date: Date) => void;
}

const ShippingCalendarSelector: React.FC<ShippingCalendarSelectorProps> = ({
  onSelectShippingOption,
  onSelectDeliveryDate,
  onSelectActualDeliveryDate,
  selectedShippingOption,
  selectedShippingDate,
  selectedDeliveryDate,
  currentConsignment,
  product,
  isLoading,
  onAutoSubmit
}) => {
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [showModal, setShowModal] = useState<boolean>(false);
  const [selectedDayMethods, setSelectedDayMethods] = useState<any[]>([]);
  const [selectedDateString, setSelectedDateString] = useState<string>("");
  const [selectedDayObject, setSelectedDayObject] = useState<Date | null>(null);
  const [loadingMethods, setLoadingMethods] = useState<boolean>(false);
  const [methodsCache, setMethodsCache] = useState<Map<string, any[]>>(new Map());
  const [availableDates, setAvailableDates] = useState<Date[]>([]);
  const [loadingAvailableDates, setLoadingAvailableDates] = useState<boolean>(true);


  useEffect(() => {
    const initializeAvailableDates = async () => {
      setLoadingAvailableDates(true);

      // Try to get from session storage first
      const cachedDates = sessionStorage.getItem('availableDates');
      if (cachedDates) {
        try {
          const parsedDates = JSON.parse(cachedDates);
          const dates = parsedDates.map((dateString: string) => {
            const date = new Date(dateString);
            date.setHours(0, 0, 0, 0);
            return date;
          });

          if (dates.length > 0) {
            setAvailableDates(dates);
            setLoadingAvailableDates(false);
            return;
          }
        } catch (error) {
          console.error('Error parsing cached dates:', error);
        }
      }

      // If not in session or empty, fetch from API
      const fetchedDates = await fetchAvailableDates();

      // Store in session storage
      if (fetchedDates.length > 0) {
        const dateStrings = fetchedDates.map((date: { toISOString: () => any; }) => date.toISOString());
        sessionStorage.setItem('availableDates', JSON.stringify(dateStrings));
      }

      setAvailableDates(fetchedDates);
      setLoadingAvailableDates(false);
    };

    initializeAvailableDates();
  }, [product.productId, currentConsignment?.shippingAddress]);

  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (year: number, month: number) => {
    return new Date(year, month, 1).getDay();
  };

  const isDateAvailable = (date: Date) => {
    const dateString = date.toDateString();
    return availableDates.some(availableDate => availableDate.toDateString() === dateString);
  };

  const getCachedMethods = (date: Date): any[] | undefined => {
    const dateKey = date.toISOString().split('T')[0];
    return methodsCache.get(dateKey);
  };

  const fetchAvailableDates = async () => {
    try {
      const shippingAddress = currentConsignment?.shippingAddress;
      if (!shippingAddress) {
        throw new Error('No shipping address found');
      }

      const requestBody = {
        ratingInfo: {
          cart: {
            items: [
              {
                itemId: String(product.productId),
                sku: product.sku,
                weight: 1,
                qty: product.quantity || 1,
                type: "SIMPLE"
              }
            ]
          },
          destination: {
            country: shippingAddress.countryCode || "US",
            region: shippingAddress.stateOrProvinceCode || shippingAddress.stateOrProvince,
            city: shippingAddress.city,
            zipcode: shippingAddress.postalCode,
            street: shippingAddress.address1
          },
          customer: {
            customerGroup: "Retail"
          },
          cartType: "STD"
        }
      };

      const response = await fetch('https://bc-middleware-mm.onrender.com/get-availabledates', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch available dates: ${response.status}`);
      }

      const availableDatesData = await response.json();

      // Check if the response is empty
      if (!availableDatesData || availableDatesData.length === 0) {
        // Generate dates from tomorrow for the next 3 months (excluding Sat & Sun)
        const dates: Date[] = [];
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);

        const threeMonthsLater = new Date(tomorrow);
        threeMonthsLater.setMonth(threeMonthsLater.getMonth() + 3);

        let currentDate = new Date(tomorrow);

        while (currentDate <= threeMonthsLater) {
          const dayOfWeek = currentDate.getDay();
          // 0 = Sunday, 6 = Saturday
          if (dayOfWeek !== 0 && dayOfWeek !== 6) {
            const date = new Date(currentDate);
            date.setHours(0, 0, 0, 0);
            dates.push(date);
          }
          currentDate.setDate(currentDate.getDate() + 1);
        }

        return dates;
      }

      // Convert string dates to Date objects
      const dates = availableDatesData.map((dateString: string) => {
        const [month, day, year] = dateString.split('/');
        const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        date.setHours(0, 0, 0, 0);
        return date;
      });

      return dates;
    } catch (error) {
      console.error('Error fetching available dates:', error);

      // On error, also generate fallback dates
      const dates: Date[] = [];
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);

      const threeMonthsLater = new Date(tomorrow);
      threeMonthsLater.setMonth(threeMonthsLater.getMonth() + 3);

      let currentDate = new Date(tomorrow);

      while (currentDate <= threeMonthsLater) {
        const dayOfWeek = currentDate.getDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
          const date = new Date(currentDate);
          date.setHours(0, 0, 0, 0);
          dates.push(date);
        }
        currentDate.setDate(currentDate.getDate() + 1);
      }

      return dates;
    }
  };

  const onLoadMethods = async (date: Date) => {
    try {
      // Format date as YYYY-MM-DD HH:MM:SS
      const formattedDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} 00:00:00`;

      // Get shipping address from currentConsignment
      const shippingAddress = currentConsignment?.shippingAddress;
      if (!shippingAddress) {
        throw new Error('No shipping address found');
      }

      // Try to get product options from session storage first
      let productOptions = sessionStorage.getItem(product.productId);
      let parsedOptions = productOptions ? JSON.parse(productOptions) : null;

      // If not in session, fetch from API
      if (!parsedOptions) {
        const optionsResponse = await fetch('https://bc-middleware-mm.onrender.com/cart/get-options', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            itemId: [product.productId]
          })
        });

        if (!optionsResponse.ok) {
          throw new Error('Failed to fetch product options');
        }

        const optionsData = await optionsResponse.json();
        parsedOptions = optionsData[product.productId] || {};

        // Store in session for future use
        sessionStorage.setItem(product.productId, JSON.stringify(parsedOptions));
      }

      // Build the request body
      const requestBody = {
        ratingInfo: {
          cart: {
            items: [
              {
                itemId: String(product.productId),
                sku: product.sku,
                weight: parsedOptions.weight || product.weight || 0,
                qty: product.quantity || 1,
                type: "SIMPLE",
                attributes: [
                  {
                    name: "shipperhq_shipping_group",
                    value: parsedOptions.shippingGroup ? parsedOptions.shippingGroup.join(',') : ""
                  },
                  {
                    name: "shipperhq_shipping_fee",
                    value: String(parsedOptions.shippingRate || 0)
                  },
                  {
                    name: "shipperhq_availability_date",
                    value: formattedDate
                  }
                ]
              }
            ]
          },
          destination: {
            country: shippingAddress.countryCode || "US",
            region: shippingAddress.stateOrProvinceCode || shippingAddress.stateOrProvince,
            city: shippingAddress.city,
            zipcode: shippingAddress.postalCode,
            street: shippingAddress.address1
          },
          customer: {
            customerGroup: "Retail"
          },
          cartType: "STD"
        }
      };

      const response = await fetch('https://bc-middleware-mm.onrender.com/get-methods', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch shipping methods: ${response.status}`);
      }

      const methodsData = await response.json();

      // Get available shipping options from currentConsignment
      const availableOptions = currentConsignment?.availableShippingOptions || [];
      console.log('availableOptions', availableOptions);
      console.log('methodsData', methodsData);

      // Helper function to extract core method name from description
      const extractCoreMethod = (description: string): string => {
        // For availableOptions: Extract content between "(" and "Delivers:"
        // Example: "FedEx (Home Delivers: Sat)" -> "Home"
        const optionMatch = description.match(/\(([^)]*?)\s*Delivers:/);
        if (optionMatch) {
          return optionMatch[1].trim().toLowerCase();
        }

        // For methodsData: Extract content before "Delivers:"
        // Example: "Home Delivers: Thu" -> "Home"
        const methodMatch = description.match(/^(.*?)\s*Delivers:/);
        if (methodMatch) {
          return methodMatch[1].trim().toLowerCase();
        }

        return description.toLowerCase().trim();
      };

      // Helper function to clean description by removing "Delivers: Day" pattern
      const cleanDescription = (description: string): string => {
        // Remove "Delivers: [Day]" pattern (e.g., "Delivers: Sat", "Delivers: Wed")
        return description.replace(/\s*Delivers:\s*\w+\s*/g, '').trim();
      };

      // Helper function to format delivery date
      const formatDeliveryDate = (dateString: string): string => {
        if (!dateString) return '';

        // Parse MM/DD/YYYY format
        const [month, day, year] = dateString.split('/');
        const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));

        // Format as "Est Delivery: DD Mon YYYY" (e.g., "Est Delivery: 20 Oct 2025")
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
          'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        return `Est. Delivery: ${date.getDate()} ${monthNames[date.getMonth()]} ${date.getFullYear()}`;
      };

      // Match and filter methods based on availableShippingOptions
      const filteredMethods = availableOptions.map((option: any) => {
        // Extract core method name from option description
        const optionCoreMethod = extractCoreMethod(option.description);

        // Clean the option description for display
        const cleanedOptionDesc = cleanDescription(option.description);

        // Find matching method from API response
        const matchingMethod = methodsData.find((method: any) => {
          const methodCoreMethod = extractCoreMethod(method.methodTitle);
          return optionCoreMethod === methodCoreMethod;
        });

        // Build the description with delivery date if available
        let finalDescription = cleanedOptionDesc;
        if (matchingMethod?.deliveryDate) {
          finalDescription = `${cleanedOptionDesc} ${formatDeliveryDate(matchingMethod.deliveryDate)}`;
        }

        // Return the available option enhanced with delivery dates
        return {
          code: option.id,
          method: finalDescription,
          totalCharges: option.cost,
          deliveryDate: matchingMethod?.deliveryDate || null,
          dispatchDate: matchingMethod?.dispatchDate || null,
          isRecommended: option.isRecommended || false
        };
      }).filter((method: any) => method.deliveryDate !== null); // Only include methods that have matching delivery dates

      return filteredMethods;

    } catch (error) {
      console.error('Error loading shipping methods:', error);
      return [];
    }
  }

  const handleLoadMethods = async (date: Date) => {
    const cachedMethods = getCachedMethods(date);

    if (cachedMethods) {
      // If we have cached methods, show them immediately
      setSelectedDayMethods(cachedMethods);
      setSelectedDateString(date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      }));
      setSelectedDayObject(date);
      setShowModal(true);
      return;
    }

    // Otherwise, load methods
    setLoadingMethods(true);
    setSelectedDateString(date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }));
    setSelectedDayObject(date);
    setShowModal(true);

    try {
      const methods = await onLoadMethods(date);
      setSelectedDayMethods(methods);

      // Cache the methods
      const dateKey = date.toISOString().split('T')[0];
      setMethodsCache(prev => new Map(prev).set(dateKey, methods));
    } catch (error) {
      console.error('Error loading methods:', error);
      setSelectedDayMethods([]);
    } finally {
      setLoadingMethods(false);
    }
  };

  const handlePrevMonth = (e: React.MouseEvent) => {
    e.stopPropagation();

    setSelectedMonth(prevMonth => {
      if (prevMonth === 0) {
        setSelectedYear(prevYear => prevYear - 1);
        return 11;
      }
      return prevMonth - 1;
    });
  };

  const handleNextMonth = (e: React.MouseEvent) => {
    e.stopPropagation();

    setSelectedMonth(prevMonth => {
      if (prevMonth === 11) {
        setSelectedYear(prevYear => prevYear + 1);
        return 0;
      }
      return prevMonth + 1;
    });
  };

  const handleMethodSelect = (method: any) => {
    const option = {
      id: method.code,
      description: method.method,
      cost: method.totalCharges,
      deliveryDate: method.deliveryDate,
      dispatchDate: method.dispatchDate
    };

    onSelectShippingOption(option);

    if (selectedDayObject) {
      onSelectDeliveryDate(selectedDayObject);
      if (method.deliveryDate) {
        const [month, day, year] = method.deliveryDate.split('/');
        const deliveryDateObj = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        deliveryDateObj.setHours(0, 0, 0, 0);
        onSelectActualDeliveryDate(deliveryDateObj);
      }
      onAutoSubmit(option, selectedDayObject);
    }
  };

  const renderCalendar = () => {
    const daysInMonth = getDaysInMonth(selectedYear, selectedMonth);
    const firstDayOfMonth = getFirstDayOfMonth(selectedYear, selectedMonth);

    const days = [];

    // Empty cells for days before the first of the month
    for (let i = 0; i < firstDayOfMonth; i++) {
      days.push(<div key={`empty-${i}`} className="tt-day-empty"></div>);
    }

    // Calendar days
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(selectedYear, selectedMonth, day);
      const isAvailable = isDateAvailable(date);
      const isToday = date.toDateString() === new Date().toDateString();
      const isSelectedDate = selectedShippingDate &&
        date.getDate() === selectedShippingDate.getDate() &&
        date.getMonth() === selectedShippingDate.getMonth() &&
        date.getFullYear() === selectedShippingDate.getFullYear();

      days.push(
        <div
          key={day}
          className={`tt-day ${isToday ? 'tt-day-today' : ''} ${isSelectedDate ? 'tt-day-selected' : ''} ${!isAvailable ? 'tt-day-disabled' : ''}`}
        >
          <div className="tt-day-header">
            <span className="tt-day-number">{day}</span>
          </div>
          <div className="tt-method-list">
            {isAvailable && (
              <div className="tt-method-item">
                <button
                  className="tt-load-methods-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleLoadMethods(date);
                  }}
                  type="button"
                >
                  Select Delivery Option
                </button>
              </div>
            )}
          </div>
        </div>
      );
    }

    return days;
  };

  return (
    <div className="shipping-calendar-container">
      {isLoading || loadingAvailableDates ? (
        <div className="tt-loading">
          <div>{loadingAvailableDates ? 'Loading available dates...' : 'Loading calendar...'}</div>
        </div>
      ) : (
        <>
          <div className="tt-header">
            <div className="tt-title-container">
              <h3 className="tt-title">Select Ship Date</h3>
            </div>
            <div className="tt-nav">
              <button
                onClick={handlePrevMonth}
                className="tt-nav-button"
                type="button"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6"></polyline>
                </svg>
              </button>
              <span className="tt-month-year">
                {new Date(selectedYear, selectedMonth).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              </span>
              <button
                onClick={handleNextMonth}
                className="tt-nav-button"
                type="button"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
              </button>
            </div>
          </div>

          <div className="tt-weekdays">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
              <div key={day} className="tt-weekday">
                {day}
              </div>
            ))}
          </div>

          <div className="tt-grid">
            {renderCalendar()}
          </div>

          {selectedShippingOption && selectedShippingDate && (
            <div className="selected-shipping-container">
              <div className="selected-shipping-info">
                <div>
                  <div className="selected-shipping-label">Selected Delivery Method:</div>
                  <div className="selected-shipping-value">
                    {selectedShippingOption.description && (
                      <div>
                        {(() => {
                          let methodName = selectedShippingOption.description.split(' Delivers:')[0].split(' Est.')[0].trim();

                          // Add closing parenthesis if it's missing
                          if (methodName.includes('(') && !methodName.includes(')')) {
                            methodName += ')';
                          }

                          return methodName + ' - $'+selectedShippingOption.cost.toFixed(2);
                        })()}
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <div className="selected-shipping-label">Selected Ship Date:</div>
                  <div className="selected-shipping-value">
                    {selectedShippingDate.toLocaleDateString('en-US', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric'
                    })}
                  </div>
                </div>
                <div>
                  <div className="selected-shipping-label">Estimated Delivery Date:</div>
                  <div className="selected-shipping-value">
                    {selectedDeliveryDate
                      ? selectedDeliveryDate.toLocaleDateString('en-US', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric'
                      })
                      : 'N/A'}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Modal for showing shipping methods - keep outside the loading check */}
      {showModal && (
        <div className="tt-modal-overlay" onClick={() => setShowModal(false)}>
          <div className="tt-modal" onClick={(e) => e.stopPropagation()}>
            <div className="tt-modal-header">
              <h3 className="tt-modal-title">
                Selected Ship Date: {selectedDateString}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="tt-close-button"
                type="button"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <div className="tt-modal-body">
              {loadingMethods ? (
                <div className="tt-loading-methods">
                  <div className="tt-spinner"></div>
                  <p>Loading delivery methods...</p>
                </div>
              ) : selectedDayMethods.length > 0 ? (
                selectedDayMethods.map((method, idx) => (
                  <div
                    key={idx}
                    className={`tt-method-card ${selectedShippingOption && method.code === selectedShippingOption.id ? 'tt-method-card-selected' : ''
                      }`}
                    onClick={() => handleMethodSelect(method)}
                  >
                    <div className="tt-method-card-header">
                      <span className="tt-method-name">{method.method}</span>
                      <span className="tt-method-price">
                        ${method.totalCharges.toFixed(2)}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="tt-no-methods">
                  <p>No delivery methods available for this date.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ShippingCalendarSelector;