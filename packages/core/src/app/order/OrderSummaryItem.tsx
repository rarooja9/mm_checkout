import classNames from 'classnames';
import { isNumber } from 'lodash';
import React, { FunctionComponent, memo, ReactNode } from 'react';

import { ShopperCurrency } from '../currency';

export interface OrderSummaryItemProps {
    id: string | number;
    amount: number;
    quantity: number;
    name: string;
    amountAfterDiscount?: number;
    image?: ReactNode;
    description?: ReactNode;
    productOptions?: OrderSummaryItemOption[];
}

export interface OrderSummaryItemOption {
    testId: string;
    content: ReactNode;
}

const OrderSummaryItem: FunctionComponent<OrderSummaryItemProps> = ({
    amount,
    amountAfterDiscount,
    image,
    name,
    productOptions,
    quantity,
    description,
}) => {
    // Filter out any product options that contain "Delivery Date"
    const filteredOptions = productOptions?.filter(option => {
        // Check if the content is a string or has a string representation
        const optionContent = String(option.content || '');
        
        // Return false (exclude) if the option contains "Delivery Date"
        return !optionContent.includes('Delivery Date');
    });

    return (
        <div className="product" data-test="cart-item">
            <figure className="product-column product-figure">{image}</figure>

            <div className="product-column product-body">
                <h4
                    className="product-title optimizedCheckout-contentPrimary"
                    data-test="cart-item-product-title"
                >
                    {`${quantity} x ${name}`}
                </h4>
                {filteredOptions && filteredOptions.length > 0 && (
                    <ul
                        className="product-options optimizedCheckout-contentSecondary"
                        data-test="cart-item-product-options"
                    >
                        {filteredOptions.map((option, index) => (
                            <li className="product-option" data-test={option.testId} key={index}>
                                {option.content}
                            </li>
                        ))}
                    </ul>
                )}
                {description && (
                    <div
                        className="product-description optimizedCheckout-contentSecondary"
                        data-test="cart-item-product-description"
                    >
                        {description}
                    </div>
                )}
            </div>

            <div className="product-column product-actions">
                <div
                    className={classNames('product-price', 'optimizedCheckout-contentPrimary', {
                        'product-price--beforeDiscount':
                            isNumber(amountAfterDiscount) && amountAfterDiscount !== amount,
                    })}
                    data-test="cart-item-product-price"
                >
                    <ShopperCurrency amount={amount} />
                </div>

                {isNumber(amountAfterDiscount) && amountAfterDiscount !== amount && (
                    <div className="product-price" data-test="cart-item-product-price--afterDiscount">
                        <ShopperCurrency amount={amountAfterDiscount} />
                    </div>
                )}
            </div>
        </div>
    );
};

export default memo(OrderSummaryItem);